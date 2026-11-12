import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from "node:sqlite";
import type { FeePolicy, ShippingRules } from "./domain.js";

export type ItemStatus = "OPEN" | "CLAIMED" | "INVOICED" | "PAID" | "SHIPPED";

export interface SaleRow {
  id: string;
  slug: string;
  title: string;
  status: "OPEN" | "CLOSED";
  invoice_mode: "sale_close" | "first_claim";
  closes_at_ms: number;
  published_at_ms: number | null;
  shipping_json: string;
  fee_policy: FeePolicy;
  fee_rate_bp: number;
  fee_fixed_cents: number;
  deposit_bp: number;
  owner_key_hash: string;
  created_at_ms: number;
}

export interface ItemRow {
  id: string;
  sale_id: string;
  number: number;
  title: string;
  set_or_platform: string | null;
  condition_notes: string | null;
  price_cents: number | null;
  confidence: number | null;
  status: ItemStatus;
  created_at_ms: number;
}

export interface ClaimRow {
  id: string;
  item_id: string;
  sale_id: string;
  handle: string;
  email: string;
  at_ms: number;
  sequence: number;
  kind: "claim" | "backup";
  source: "web" | "import";
  raw: string | null;
  hold: number;
  created_at_ms: number;
}

export interface InvoiceRow {
  id: string;
  sale_id: string;
  buyer_handle: string;
  buyer_email: string;
  paypal_invoice_id: string | null;
  payer_url: string | null;
  status: string;
  subtotal_cents: number;
  shipping_cents: number;
  fee_cents: number;
  total_cents: number;
  deposit_cents: number | null;
  due_at_ms: number;
  created_at_ms: number;
}

export interface EventRow {
  id: string;
  sale_id: string;
  item_id: string | null;
  type: string;
  payload: string;
  at_ms: number;
}

export const db = (() => {
  const dir = process.env.DATA_DIR || "./data";
  mkdirSync(dir, { recursive: true });
  const database = new DatabaseSync(join(dir, "app.db"));
  database.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('OPEN','CLOSED')) DEFAULT 'OPEN',
      invoice_mode TEXT NOT NULL CHECK(invoice_mode IN ('sale_close','first_claim')),
      closes_at_ms INTEGER NOT NULL, published_at_ms INTEGER, shipping_json TEXT NOT NULL,
      fee_policy TEXT NOT NULL CHECK(fee_policy IN ('seller_absorbs','split','buyer_pays')),
      fee_rate_bp INTEGER NOT NULL, fee_fixed_cents INTEGER NOT NULL,
      owner_key_hash TEXT NOT NULL, created_at_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      number INTEGER NOT NULL, title TEXT NOT NULL, set_or_platform TEXT, condition_notes TEXT,
      price_cents INTEGER CHECK(price_cents IS NULL OR price_cents > 0), confidence REAL,
      status TEXT NOT NULL CHECK(status IN ('OPEN','CLAIMED','INVOICED','PAID','SHIPPED')) DEFAULT 'OPEN',
      created_at_ms INTEGER NOT NULL, UNIQUE(sale_id, number)
    );
    CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      handle TEXT NOT NULL, email TEXT NOT NULL, at_ms INTEGER NOT NULL, sequence INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('claim','backup')), source TEXT NOT NULL CHECK(source IN ('web','import')),
      raw TEXT, created_at_ms INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS claims_handle_per_item ON claims(item_id, lower(handle));
    CREATE INDEX IF NOT EXISTS claims_order ON claims(item_id, at_ms, sequence);
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      buyer_handle TEXT NOT NULL, buyer_email TEXT NOT NULL, paypal_invoice_id TEXT UNIQUE,
      payer_url TEXT, status TEXT NOT NULL, subtotal_cents INTEGER NOT NULL, shipping_cents INTEGER NOT NULL,
      fee_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL, due_at_ms INTEGER NOT NULL, created_at_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invoice_items (
      invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES items(id), claim_id TEXT NOT NULL UNIQUE REFERENCES claims(id), PRIMARY KEY(invoice_id, item_id)
    );
    CREATE TABLE IF NOT EXISTS operations (
      id TEXT PRIMARY KEY, operation TEXT NOT NULL, target TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE,
      request_json TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('PENDING','SUCCEEDED','FAILED')),
      response_json TEXT, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
      UNIQUE(operation, target)
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      item_id TEXT, type TEXT NOT NULL, payload TEXT NOT NULL, at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_by_sale ON events(sale_id, at_ms, id);
    CREATE TABLE IF NOT EXISTS shipments (
      id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL UNIQUE REFERENCES invoices(id),
      carrier TEXT NOT NULL, tracking TEXT NOT NULL, created_at_ms INTEGER NOT NULL
    );
    PRAGMA user_version=1;
  `);
  const addColumn = (table: string, column: string, ddl: string) => {
    if (!(database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((row) => row.name === column)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  };
  addColumn("sales", "deposit_bp", "INTEGER NOT NULL DEFAULT 2000");
  addColumn("claims", "hold", "INTEGER NOT NULL DEFAULT 0");
  addColumn("invoices", "deposit_cents", "INTEGER");
  addColumn("shipments", "paypal_tracker_id", "TEXT");
  return database;
})();

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function matchesOwnerKey(sale: SaleRow, key: string | undefined): boolean {
  return !!key && hashKey(key) === sale.owner_key_hash;
}

export function createSale(input: {
  title: string;
  deadlineMinutes: number;
  invoiceMode: "sale_close" | "first_claim";
  shipping: ShippingRules;
  feePolicy: FeePolicy;
  feeRateBasisPoints: number;
  feeFixedCents: number;
  depositBasisPoints: number;
}): { sale: SaleRow; ownerKey: string } {
  const id = randomUUID();
  const slug = randomBytes(5).toString("base64url");
  const ownerKey = randomBytes(32).toString("base64url");
  const now = Date.now();
  db.prepare(`INSERT INTO sales(id,slug,title,invoice_mode,closes_at_ms,shipping_json,fee_policy,fee_rate_bp,fee_fixed_cents,deposit_bp,owner_key_hash,created_at_ms)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, slug, input.title, input.invoiceMode, now + input.deadlineMinutes * 60_000,
    JSON.stringify(input.shipping), input.feePolicy, input.feeRateBasisPoints, input.feeFixedCents, input.depositBasisPoints, hashKey(ownerKey), now);
  return { sale: getSaleById(id)!, ownerKey };
}

export function getSaleById(id: string): SaleRow | undefined {
  return db.prepare("SELECT * FROM sales WHERE id=?").get(id) as SaleRow | undefined;
}

export function getSaleBySlug(slug: string): SaleRow | undefined {
  return db.prepare("SELECT * FROM sales WHERE slug=?").get(slug) as SaleRow | undefined;
}

export function listItems(saleId: string): ItemRow[] {
  return db.prepare("SELECT * FROM items WHERE sale_id=? ORDER BY number").all(saleId) as unknown as ItemRow[];
}

export function getItem(itemId: string): ItemRow | undefined {
  return db.prepare("SELECT * FROM items WHERE id=?").get(itemId) as ItemRow | undefined;
}

export function addItem(saleId: string, item: { title: string; setOrPlatform?: string | null; conditionNotes?: string | null; priceCents?: number | null; confidence?: number | null }): ItemRow {
  const number = Number((db.prepare("SELECT COALESCE(MAX(number),0)+1 AS n FROM items WHERE sale_id=?").get(saleId) as { n: number }).n);
  const id = randomUUID();
  const now = Date.now();
  db.prepare("INSERT INTO items(id,sale_id,number,title,set_or_platform,condition_notes,price_cents,confidence,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(id, saleId, number, item.title, item.setOrPlatform ?? null, item.conditionNotes ?? null, item.priceCents ?? null, item.confidence ?? null, now);
  return getItem(id)!;
}

export function updateItem(itemId: string, item: { title: string; setOrPlatform?: string | null; conditionNotes?: string | null; priceCents: number }): ItemRow {
  db.prepare("UPDATE items SET title=?,set_or_platform=?,condition_notes=?,price_cents=? WHERE id=?")
    .run(item.title, item.setOrPlatform ?? null, item.conditionNotes ?? null, item.priceCents, itemId);
  return getItem(itemId)!;
}

export function deleteItem(itemId: string): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    const item = getItem(itemId);
    if (!item) throw new Error("Item not found");
    db.prepare("DELETE FROM items WHERE id=?").run(itemId);
    const rows = db.prepare("SELECT id FROM items WHERE sale_id=? ORDER BY number").all(item.sale_id) as Array<{ id: string }>;
    rows.forEach((row, index) => db.prepare("UPDATE items SET number=? WHERE id=?").run(index + 1, row.id));
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function addClaim(input: Omit<ClaimRow, "id" | "created_at_ms">): ClaimRow {
  const id = randomUUID();
  const created = Date.now();
  db.prepare("INSERT INTO claims(id,item_id,sale_id,handle,email,at_ms,sequence,kind,source,raw,hold,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, input.item_id, input.sale_id, input.handle, input.email, input.at_ms, input.sequence, input.kind, input.source, input.raw, input.hold, created);
  return db.prepare("SELECT * FROM claims WHERE id=?").get(id) as unknown as ClaimRow;
}

export function listClaims(saleId: string): ClaimRow[] {
  return db.prepare("SELECT * FROM claims WHERE sale_id=? ORDER BY at_ms,sequence").all(saleId) as unknown as ClaimRow[];
}

export function nextClaimSequence(saleId: string): number {
  return Number((db.prepare("SELECT COALESCE(MAX(sequence),0)+1 AS n FROM claims WHERE sale_id=?").get(saleId) as { n: number }).n);
}

export function listItemClaims(itemId: string): ClaimRow[] {
  return db.prepare("SELECT * FROM claims WHERE item_id=? ORDER BY at_ms,sequence").all(itemId) as unknown as ClaimRow[];
}

export function closeSale(saleId: string): void {
  db.prepare("UPDATE sales SET status='CLOSED' WHERE id=?").run(saleId);
}

export function publishSale(saleId: string): void {
  db.prepare("UPDATE sales SET published_at_ms=? WHERE id=? AND published_at_ms IS NULL").run(Date.now(), saleId);
}

export function addEvent(saleId: string, type: string, payload: unknown, itemId: string | null = null): EventRow {
  const event = { id: randomUUID(), sale_id: saleId, item_id: itemId, type, payload: JSON.stringify(payload), at_ms: Date.now() };
  db.prepare("INSERT INTO events(id,sale_id,item_id,type,payload,at_ms) VALUES(?,?,?,?,?,?)").run(event.id, event.sale_id, event.item_id, event.type, event.payload, event.at_ms);
  return event;
}

export function listEvents(saleId: string): EventRow[] {
  return db.prepare("SELECT * FROM events WHERE sale_id=? ORDER BY at_ms,id").all(saleId) as unknown as EventRow[];
}

export function createInvoice(input: Omit<InvoiceRow, "id" | "created_at_ms">, claims: Array<{ itemId: string; claimId: string }>): InvoiceRow {
  const id = randomUUID();
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`INSERT INTO invoices(id,sale_id,buyer_handle,buyer_email,paypal_invoice_id,payer_url,status,subtotal_cents,shipping_cents,fee_cents,total_cents,deposit_cents,due_at_ms,created_at_ms)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, input.sale_id, input.buyer_handle, input.buyer_email, input.paypal_invoice_id, input.payer_url, input.status, input.subtotal_cents, input.shipping_cents, input.fee_cents, input.total_cents, input.deposit_cents, input.due_at_ms, now);
    const put = db.prepare("INSERT INTO invoice_items(invoice_id,item_id,claim_id) VALUES(?,?,?)");
    for (const claim of claims) put.run(id, claim.itemId, claim.claimId);
    const itemIds = claims.map((claim) => claim.itemId);
    db.prepare("UPDATE items SET status='INVOICED' WHERE id IN (" + itemIds.map(() => "?").join(",") + ")").run(...itemIds);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getInvoice(id)!;
}

export function updateInvoice(invoiceId: string, patch: Partial<Pick<InvoiceRow, "paypal_invoice_id" | "payer_url" | "status">>): void {
  const keys = Object.keys(patch) as Array<keyof typeof patch>;
  if (!keys.length) return;
  db.prepare(`UPDATE invoices SET ${keys.map((key) => `${key}=?`).join(",")} WHERE id=?`).run(...keys.map((key) => patch[key] as SQLInputValue), invoiceId);
}

export function getInvoice(id: string): InvoiceRow | undefined {
  return db.prepare("SELECT * FROM invoices WHERE id=?").get(id) as InvoiceRow | undefined;
}

export function getInvoiceByPayPal(id: string): InvoiceRow | undefined {
  return db.prepare("SELECT * FROM invoices WHERE paypal_invoice_id=?").get(id) as InvoiceRow | undefined;
}

export function listInvoices(saleId: string): Array<InvoiceRow & { items: ItemRow[]; shipment?: { carrier: string; tracking: string } }> {
  const rows = db.prepare("SELECT * FROM invoices WHERE sale_id=? ORDER BY created_at_ms DESC").all(saleId) as unknown as InvoiceRow[];
  return rows.map((row) => ({ ...row, items: db.prepare("SELECT items.* FROM items JOIN invoice_items ON invoice_items.item_id=items.id WHERE invoice_items.invoice_id=? ORDER BY items.number").all(row.id) as unknown as ItemRow[], shipment: db.prepare("SELECT carrier,tracking,paypal_tracker_id FROM shipments WHERE invoice_id=?").get(row.id) as { carrier: string; tracking: string; paypal_tracker_id: string | null } | undefined }));
}

// Every open invoice is read each pass: payment can land long before the deadline.
// ponytail: one PayPal GET per open invoice per 15 s; switch to webhooks first if sales grow past a few hundred open invoices.
export function listOutstandingInvoices(): InvoiceRow[] {
  return db.prepare("SELECT * FROM invoices WHERE status IN ('SENT','UNPAID','HELD')").all() as unknown as InvoiceRow[];
}

export function listDraftInvoices(): InvoiceRow[] {
  return db.prepare("SELECT * FROM invoices WHERE status='DRAFT'").all() as unknown as InvoiceRow[];
}

export function listSalesToClose(now = Date.now()): SaleRow[] {
  return db.prepare("SELECT * FROM sales WHERE status='OPEN' AND published_at_ms IS NOT NULL AND closes_at_ms<=?").all(now) as unknown as SaleRow[];
}

export function invoiceItems(invoiceId: string): ItemRow[] {
  return db.prepare("SELECT items.* FROM items JOIN invoice_items ON invoice_items.item_id=items.id WHERE invoice_items.invoice_id=? ORDER BY items.number").all(invoiceId) as unknown as ItemRow[];
}

export function markInvoicePaid(invoice: InvoiceRow): boolean {
  db.exec("BEGIN IMMEDIATE");
  try {
    const changed = db.prepare("UPDATE invoices SET status='PAID' WHERE id=? AND status IN ('DRAFT','SENT','UNPAID','HELD')").run(invoice.id);
    if (changed.changes) db.prepare("UPDATE items SET status='PAID' WHERE id IN (SELECT item_id FROM invoice_items WHERE invoice_id=?)").run(invoice.id);
    db.exec("COMMIT");
    return changed.changes > 0;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function markInvoiceHeld(invoice: InvoiceRow): boolean {
  return db.prepare("UPDATE invoices SET status='HELD' WHERE id=? AND status IN ('SENT','UNPAID')").run(invoice.id).changes > 0;
}

export function markInvoiceCancelled(invoice: InvoiceRow): boolean {
  db.exec("BEGIN IMMEDIATE");
  try {
    const changed = db.prepare("UPDATE invoices SET status='CANCELLED' WHERE id=? AND status IN ('SENT','UNPAID')").run(invoice.id);
    if (changed.changes) db.prepare("UPDATE items SET status='CLAIMED' WHERE id IN (SELECT item_id FROM invoice_items WHERE invoice_id=?) AND status='INVOICED'").run(invoice.id);
    db.exec("COMMIT");
    return changed.changes > 0;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function nextBackup(itemId: string): ClaimRow | undefined {
  return db.prepare(`SELECT claims.* FROM claims LEFT JOIN invoice_items ON invoice_items.claim_id=claims.id
    WHERE claims.item_id=? AND claims.kind IN ('claim','backup') AND invoice_items.claim_id IS NULL
    ORDER BY claims.at_ms,claims.sequence LIMIT 1`).get(itemId) as unknown as ClaimRow | undefined;
}

export function unbilledClaimCount(itemId: string): number {
  return Number((db.prepare("SELECT COUNT(*) AS n FROM claims LEFT JOIN invoice_items ON invoice_items.claim_id=claims.id WHERE claims.item_id=? AND invoice_items.claim_id IS NULL").get(itemId) as { n: number }).n);
}

export function addOperation(operation: string, target: string, requestJson: string): { requestId: string; state: string } {
  const existing = db.prepare("SELECT request_id,state FROM operations WHERE operation=? AND target=?").get(operation, target) as { request_id: string; state: string } | undefined;
  if (existing) return { requestId: existing.request_id, state: existing.state };
  const requestId = randomUUID();
  const now = Date.now();
  db.prepare("INSERT INTO operations(id,operation,target,request_id,request_json,state,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,'PENDING',?,?)")
    .run(randomUUID(), operation, target, requestId, requestJson, now, now);
  return { requestId, state: "PENDING" };
}

export function updateOperation(operation: string, target: string, state: "SUCCEEDED" | "FAILED", response: unknown): void {
  db.prepare("UPDATE operations SET state=?,response_json=?,updated_at_ms=? WHERE operation=? AND target=?").run(state, JSON.stringify(response), Date.now(), operation, target);
}

export function addShipment(invoiceId: string, carrier: string, tracking: string, paypalTrackerId: string): void {
  db.prepare("INSERT INTO shipments(id,invoice_id,carrier,tracking,paypal_tracker_id,created_at_ms) VALUES(?,?,?,?,?,?) ON CONFLICT(invoice_id) DO UPDATE SET carrier=excluded.carrier,tracking=excluded.tracking,paypal_tracker_id=excluded.paypal_tracker_id,created_at_ms=excluded.created_at_ms")
    .run(randomUUID(), invoiceId, carrier, tracking, paypalTrackerId, Date.now());
  db.prepare("UPDATE items SET status='SHIPPED' WHERE id IN (SELECT item_id FROM invoice_items WHERE invoice_id=?) AND status='PAID'").run(invoiceId);
}

export function unclaimedItems(saleId: string): ItemRow[] {
  return db.prepare("SELECT * FROM items WHERE sale_id=? AND status='OPEN' ORDER BY number").all(saleId) as unknown as ItemRow[];
}

export function buyerClaims(saleId: string, handle: string): ClaimRow[] {
  return db.prepare("SELECT * FROM claims WHERE sale_id=? AND lower(handle)=lower(?) ORDER BY at_ms,sequence").all(saleId, handle) as unknown as ClaimRow[];
}

export function updateItemStatus(itemId: string, status: ItemStatus): void {
  db.prepare("UPDATE items SET status=? WHERE id=?").run(status, itemId);
}

export function rawQuery<T extends Record<string, SQLOutputValue>>(sql: string, ...values: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...values) as unknown as T[];
}
