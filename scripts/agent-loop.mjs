// Agent checkout against a live Dibs: seller lists a photographed item, an MCP client claims it
// (402-style payment block) and then waits on await_payment while a person pays the PayPal invoice.
// Usage: node scripts/agent-loop.mjs --photo card.jpg [--title "Irene Adler"] [--price 2600]
//          [--email buyer@example.com] [--handle kamal_demo] [--timeout 600] [--out transcript.txt] [--state sale.json]
//        node scripts/agent-loop.mjs --sale <slug> ...   reuse an existing sale, skip the seller step
// DIBS_BASE_URL picks the API (default https://dibs-claims.fly.dev). The seller key goes to --state, never stdout.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const { values: opt } = parseArgs({ options: {
  photo: { type: "string" }, title: { type: "string", default: "Irene Adler" }, price: { type: "string", default: "2600" },
  email: { type: "string" }, handle: { type: "string", default: "kamal_demo" }, sale: { type: "string" },
  timeout: { type: "string", default: "600" }, out: { type: "string" }, state: { type: "string" },
} });
const base = (process.env.DIBS_BASE_URL || "https://dibs-claims.fly.dev").replace(/\/+$/, "");
const log = (text) => { console.log(text); if (opt.out) appendFileSync(opt.out, `${text}\n`); };
if (opt.out) writeFileSync(opt.out, "");

async function api(path, init = {}, key) {
  const headers = new Headers(init.headers);
  if (key) headers.set("x-seller-key", key);
  if (typeof init.body === "string") headers.set("content-type", "application/json");
  const response = await fetch(`${base}${path}`, { ...init, headers });
  const body = await response.json();
  if (!response.ok) throw new Error(`${init.method || "GET"} ${path}: ${response.status} ${body.error ?? ""}`);
  return body;
}

let slug = opt.sale;
if (!slug) {
  if (!opt.photo) throw new Error("--photo is required when creating a sale");
  const { sale, ownerKey } = await api("/api/sales", { method: "POST", body: JSON.stringify({ title: "Conan Doyle singles", deadlineMinutes: 1440, invoiceMode: "first_claim", shippingTiers: [{ label: "Mailer", amountCents: 100 }], feePolicy: "split" }) });
  const { item } = await api(`/api/sales/${sale.id}/items`, { method: "POST", body: JSON.stringify({ title: opt.title, setOrPlatform: "Conan Doyle Characters", conditionNotes: "Sleeved, sharp corners", priceCents: Number(opt.price) }) }, ownerKey);
  const form = new FormData();
  form.set("photo", new Blob([readFileSync(opt.photo)], { type: "image/jpeg" }), basename(opt.photo));
  const { item: withPhoto } = await api(`/api/items/${item.id}/photo`, { method: "PUT", body: form }, ownerKey);
  await api(`/api/sales/${sale.id}/publish`, { method: "POST" }, ownerKey);
  slug = sale.slug;
  if (opt.state) writeFileSync(opt.state, JSON.stringify({ saleId: sale.id, slug, itemId: item.id, ownerKey, dash: `${base}/dash/${sale.id}` }, null, 2));
  log(`Seller: sale ${sale.id} published at ${base}/s/${slug}, item ${item.id} photo ${base}${withPhoto.photoUrl}`);
}
const email = opt.email || (await api("/api/config")).demoBuyerEmail;
if (!email) throw new Error("--email is required (no demoBuyerEmail on this Dibs)");

const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", "src/mcp/main.ts"], env: { ...process.env, DIBS_BASE_URL: base }, stderr: "ignore" });
const client = new Client({ name: "dibs-agent-loop", version: "1.0.0" });
await client.connect(transport);
const call = async (name, args, options) => {
  log(`\n> ${name} ${JSON.stringify(args)}`);
  const result = await client.callTool({ name, arguments: args }, undefined, options);
  log(result.content.map((part) => part.text).join("\n"));
  if (result.isError) throw new Error(`${name} failed`);
  return result.structuredContent;
};

await call("list_sale", { sale: slug });
const claimed = await call("claim", { sale: slug, itemNumbers: [1], handle: opt.handle, email });
log(`\npayment ${JSON.stringify(claimed.payment)}`);
if (claimed.payment?.status !== "payment_required" || claimed.payment.httpStatusEquivalent !== 402 || !/^INV2-/.test(claimed.payment.paypalInvoiceId ?? "") || !claimed.payment.payUrl) throw new Error("claim did not return a 402-style payment requirement");
log(`\nPAY NOW: ${claimed.payment.payUrl}`);
const waited = await call("await_payment", { invoiceId: claimed.payment.invoiceId, timeoutSeconds: Number(opt.timeout), intervalSeconds: 4 }, { timeout: (Number(opt.timeout) + 60) * 1000, resetTimeoutOnProgress: true, onprogress: () => undefined });
log(`\nawait_payment ${JSON.stringify(waited)}`);
await client.close();
process.exitCode = waited.outcome === "paid" ? 0 : 2;
