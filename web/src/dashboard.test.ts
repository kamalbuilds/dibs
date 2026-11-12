// @vitest-environment jsdom
import { expect, it, vi } from "vitest";

const sale = { id: "sale1", slug: "binder", title: "Friday binder", status: "CLOSED", closes_at_ms: Date.now() - 1000 };
const item = { id: "item1", number: 1, title: "Charizard Base Set", price_cents: 2500, status: "INVOICED" };
const claims = [
  { item_id: "item1", handle: "alice", email: "a@example.com", at_ms: 1000, kind: "claim", sequence: 1 },
  { item_id: "item1", handle: "bob", email: "b@example.com", at_ms: 2000, kind: "backup", sequence: 2 },
];
const invoice = (id: string, handle: string, status: string) => ({ id, buyer_handle: handle, buyer_email: `${handle}@example.com`, status, subtotal_cents: 2500, shipping_cents: 500, fee_cents: 100, total_cents: 3100, due_at_ms: Date.now() + 3_600_000, payer_url: null, items: [item] });
const before = { sale, items: [item], claims, invoices: [invoice("inv-a", "alice", "SENT")], events: [] };
// listInvoices is newest first: after the pass, bob's new invoice leads and alice's cancelled one follows.
const after = { ...before, invoices: [invoice("inv-b", "bob", "SENT"), invoice("inv-a", "alice", "CANCELLED")] };

it("moves the docket row to the backup buyer on the SSE event and keeps the totals row free of Invalid Number", async () => {
  let state: unknown = before;
  const listeners = new Map<string, (event: MessageEvent) => void>();
  vi.stubGlobal("EventSource", class { static CLOSED = 2; readyState = 1; onopen = null; onerror = null; addEventListener(type: string, fn: (event: MessageEvent) => void) { listeners.set(type, fn); } close() {} });
  vi.stubGlobal("fetch", async (path: string) => new Response(JSON.stringify(path === "/api/sales/sale1" ? state : { missing: [] })));
  localStorage.setItem("dibs-owner:sale1", "k");
  document.body.innerHTML = '<div id="root"></div>';
  history.pushState(null, "", "/dash/sale1");
  await import("./main.tsx");

  const cell = (row: string, col: string) => document.querySelector(`${row} [col-id="${col}"]`)?.textContent ?? null;
  const dataRow = '.ag-center-cols-container .ag-row[row-index="0"]';
  await vi.waitFor(() => expect(cell(dataRow, "buyer")).toBe("@alice"), { timeout: 15000 });
  expect(cell(dataRow, "backup")).toBe("1");
  expect([...document.querySelectorAll(".ag-header-group-text")].map((node) => node.textContent).filter(Boolean)).toEqual(["Item", "Claim", "Invoice"]);
  expect(cell(dataRow, "number")).toBe("#01");
  const totals = document.querySelector(".ag-floating-bottom")!;
  expect(totals.textContent).toContain("$31.00");
  expect(totals.querySelector('[col-id="backup"]')).not.toBeNull();
  expect(totals.textContent).not.toMatch(/Invalid/);

  state = after;
  listeners.get("backup_promoted")!(new MessageEvent("backup_promoted", { data: "{}" }));
  await vi.waitFor(() => expect(cell(dataRow, "buyer")).toBe("@bob"), { timeout: 15000 });
  expect(cell(dataRow, "backup")).toBe("0");
  expect(cell(dataRow, "claimed")).not.toBe("");
  const totalsAfter = document.querySelector(".ag-floating-bottom")!.textContent;
  expect(totalsAfter).not.toMatch(/Invalid/);
  expect(totalsAfter).toContain("$31.00");
  expect(totalsAfter).not.toContain("$62.00");
}, 40000);
