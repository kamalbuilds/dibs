const required = ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "SMOKE_BUYER_EMAIL"];
const missing = required.filter((name) => !process.env[name]);
if (process.env.PAYPAL_ENV === "live") {
  console.error("Smoke only runs against PayPal sandbox. Set PAYPAL_ENV=sandbox or leave it unset.");
  process.exit(2);
}
if (missing.length) {
  console.error(`Missing PayPal smoke credentials: ${missing.join(", ")}`);
  process.exit(2);
}

const [service, store, paypal] = await Promise.all([
  import("../src/service.ts"), import("../src/store.ts"), import("../src/paypal.ts"),
]);
const { createNewSale, addSaleItem, publish, submitClaims, closeAndInvoice, reconcileInvoices } = service;
const { getSaleById, listInvoices } = store;
const { readInvoice } = paypal;

const buyerEmail = process.env.SMOKE_BUYER_EMAIL;
const created = createNewSale({
  title: `Sandbox smoke ${new Date().toISOString()}`,
  deadlineMinutes: 5,
  invoiceMode: "sale_close",
  shipping: { tiers: [{ label: "Smoke tracked", amountCents: 0 }] },
  feePolicy: "seller_absorbs",
  feeRateBasisPoints: 349,
  feeFixedCents: 49,
});
const firstItem = addSaleItem(created.sale.id, { title: "Sandbox smoke item one", priceCents: 100 });
addSaleItem(created.sale.id, { title: "Sandbox smoke item two", priceCents: 200 });
publish(created.sale.id);
await submitClaims(created.sale.id, { handle: "@dibs-smoke-first", email: buyerEmail, itemIds: [firstItem.id] });
await submitClaims(created.sale.id, { handle: "@dibs-smoke-backup", email: buyerEmail, itemIds: [firstItem.id] });

let invoiceA;
try {
  invoiceA = (await closeAndInvoice(created.sale.id, 60_000))[0];
} catch (error) {
  console.error("Smoke could not send the first invoice", error instanceof Error ? error.message : error);
  process.exit(1);
}
if (!invoiceA?.paypal_invoice_id) {
  console.error("Smoke expected a persisted PayPal invoice ID for buyer A");
  process.exit(1);
}

const deadline = Date.now() + 150_000;
let statusA = "unknown";
let statusB = "pending";
let invoiceB;
while (Date.now() < deadline) {
  await reconcileInvoices();
  const remoteA = await readInvoice(invoiceA.paypal_invoice_id);
  statusA = remoteA.status;
  invoiceB = listInvoices(created.sale.id).find((invoice) => invoice.buyer_handle === "@dibs-smoke-backup");
  if (invoiceB?.paypal_invoice_id) statusB = (await readInvoice(invoiceB.paypal_invoice_id)).status;
  if (statusA === "CANCELLED" && ["SENT", "UNPAID"].includes(statusB)) break;
  await new Promise((resolve) => setTimeout(resolve, 5000));
}

console.log(`buyer A PayPal invoice ${invoiceA.paypal_invoice_id}: ${statusA}`);
console.log(`buyer B PayPal invoice ${invoiceB?.paypal_invoice_id ?? "not-created"}: ${statusB}`);
if (statusA !== "CANCELLED" || !["SENT", "UNPAID"].includes(statusB) || !invoiceB?.paypal_invoice_id) {
  console.error("Smoke failed: expected buyer A CANCELLED and buyer B SENT or UNPAID before the 150 second timeout");
  process.exit(1);
}

console.log(`Smoke passed for sale ${getSaleById(created.sale.id)?.id}`);
