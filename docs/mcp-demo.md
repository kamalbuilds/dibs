# Dibs MCP: 28-second agentic claim demo (402-style payment)

The story: a buyer hands a seller's claim-sale post to their AI assistant. The assistant reads the binder, claims the card, and PayPal sends a Goods & Services invoice in the same step. The claim answers with a 402-style payment-required block. The buyer pays as a guest, the assistant waits for PAID with `await_payment`, and the seller's grid flips to SOLD. Money moment by 0:20.

Record against a **fresh sale** that you create for the take. Do not use the hero binder `kJ4emW4`: a claim cannot be deleted, so demo claims would sit in the binder that judges open.

## Setup (10 minutes, before recording)

1. **Install the MCP server.** Follow "Judge quickstart" in the README: clone, `npm ci && npm run build`, add the `dibs` server to Claude Desktop, restart Claude Desktop. Leave `DIBS_SELLER_KEY` unset; this is the buyer's view.
2. **Create the sale.** On https://dibs-claims.fly.dev/new set:
   - Sale name: anything (e.g. `Conan Doyle singles`)
   - Claim window: **5 minutes**
   - Invoice timing: **After each first claim**. This is the setting that makes the claim call send the PayPal invoice.
   - Keep the shipping and fee defaults (split fee shows its own line on the invoice).
3. Press **Add item by hand**, add **Irene Adler** at **$26.00** (or use the sample table photo and price one pocket), and press **Publish sale**. Copy the binder link `https://dibs-claims.fly.dev/s/<slug>` from the docket.
4. Open `/setup` and copy the **Sandbox buyer** email.
5. Lay out two windows: Claude Desktop on the left, the binder `/s/<slug>` on the right.
6. The window is 5 minutes from publish. Start recording within a minute or two. If it lapses, create another sale (step 2).

## Script

| Time | On screen | Prompt / VO |
|---|---|---|
| 0:00 to 0:06 | Claude Desktop with the pasted seller post containing the new `/s/<slug>` link; the `list_sale` result showing the pocket, price and OPEN | Prompt: "Here's a claim sale. Grab Irene Adler for me as @kamal_demo, invoice to <sandbox email>." VO: "My assistant reads the binder." |
| 0:06 to 0:14 | `claim` tool call, then "#01 Irene Adler ($26.00): First · server time ..." and the 402-style line "402-style payment required: 27.72 USD on PayPal invoice INV2-..., pay at https://www.sandbox.paypal.com/invoice/p/#INV2-..., expires ..." next to the binder tab, where the pocket stamps CLAIMED live | VO: "It calls dibs. The Dibs server timestamps it first, and PayPal sends a Goods and Services invoice in the same step." |
| 0:14 to 0:22 | Click the pay link; sandbox invoice; pay as a guest with the test Visa; PayPal "Paid" confirmation. Claude is already running `await_payment` | VO: "I pay the PayPal invoice, with buyer protection." |
| 0:22 to 0:28 | `await_payment` returns "PAID: invoice ... 27.72 USD. Paid on PayPal."; cut to the seller docket, where the row flashes and reads SOLD · PAID with "Paid on PayPal: #01 Irene Adler sold to @kamal_demo" | VO: "The agent confirms it's paid, and the seller's grid flips to sold. If I hadn't paid, it would roll to the backup." |

(Shot list and voice-over from the Judge's review in `grok-team/RANKING.md`, with `await_payment` and the docket flip in the last beat.)

Keep a third window on the seller docket (`/dash/<sale id>`, opened from the seller's browser that created the sale) for the last shot.

### Exact prompts

1. Paste, as one message:

   > Here's a claim sale: "Conan Doyle singles, claims open now → https://dibs-claims.fly.dev/s/&lt;slug&gt;". Grab Irene Adler for me as @kamal_demo, invoice to &lt;sandbox buyer email&gt;. Then wait for my payment.

2. If Claude does not call `await_payment` on its own after showing the pay link: "I'm paying now, wait for it."

### Expected tool calls and outputs

**1. `list_sale`** `{ "sale": "https://dibs-claims.fly.dev/s/<slug>" }`

```
Conan Doyle singles (https://dibs-claims.fly.dev/s/<slug>)
Claims open until <deadline>. 1 of 1 pockets open.
#01 Irene Adler · $26.00 · OPEN
```

**2. `claim`** `{ "sale": "<slug>", "itemNumbers": [1], "handle": "@kamal_demo", "email": "<sandbox buyer email>" }`

Claude may ask you to confirm first. Answer "yes". Output (from a local run with PayPal faked, 12 Nov 2026):

```
Claim received for @kamal_demo on "Conan Doyle singles".
#01 Irene Adler ($26.00): First · server time 2026-11-12T15:44:11.143Z
PayPal invoice f2618bb2-...: SENT, $27.72, due 2026-11-13T15:44:11.145Z, pay at https://www.sandbox.paypal.com/invoice/p/#INV2-...
402-style payment required: 27.72 USD on PayPal invoice INV2-..., pay at https://www.sandbox.paypal.com/invoice/p/#INV2-..., expires 2026-11-13T15:44:11.145Z. Then call await_payment.
Next:
- PayPal has emailed a Goods & Services invoice to <sandbox buyer email>. Pay it before the due time or the item rolls to the next backup.
- After paying, call await_payment to confirm PAID (it reads PayPal on demand).
```

The structured result carries the 402-style block as `payment`:

```json
{ "status": "payment_required", "httpStatusEquivalent": 402,
  "amount": { "value": "27.72", "currency": "USD" }, "amountDueNow": { "value": "27.72", "currency": "USD" },
  "invoiceId": "f2618bb2-...", "paypalInvoiceId": "INV2-...",
  "payUrl": "https://www.sandbox.paypal.com/invoice/p/#INV2-...", "expiresAt": "2026-11-13T15:44:11.145Z" }
```

$27.72 is $26.00 + $1.00 shipping + the buyer's half of the G&S fee (split policy). Other shipping or fee settings change the number, so the VO says "the invoice", not the amount. The HTTP status of the claim stays 201: the claim succeeded, and the buyer page treats 4xx as failure. "402" lives in the body (`httpStatusEquivalent`).

**3. Pay.** Click the pay link. On the PayPal sandbox invoice page choose **debit or credit card** (guest) and use the sandbox test Visa `4111 1111 1111 1111`, any future expiry, any CVV, any name and US address. If PayPal rejects it, generate a Visa in the PayPal Developer dashboard (Testing tools, Card generator). Wallet login for the sandbox buyer has failed before; use the guest card path.

**4. `await_payment`** `{ "invoiceId": "<payment.invoiceId>" }` (defaults: wait up to 120 s, check every 4 s)

Each check asks Dibs to read the invoice from PayPal Invoicing v2 right then (`POST /api/invoices/:id/refresh`, at most one PayPal read per invoice every 3 seconds), so PAID shows within seconds of PayPal's confirmation instead of waiting for the 15-second sync.

```
PAID: invoice f2618bb2-... for @kamal_demo, 27.72 USD. Paid on PayPal. Confirmed after <n>s (<k> PayPal reads).
```

If it times out ("Still SENT after 120s ... Call await_payment again"), ask Claude to keep waiting.

**5. Seller docket.** The row flips from INVOICED to **SOLD · PAID**, flashes once, and a green line reads "Paid on PayPal: #01 Irene Adler sold to @kamal_demo". No refresh needed: it rides the existing live event stream, with a 5-second poll as backup. Local screenshots: `grok-team/dibs/shots/after/402-grid-1-invoice-sent.png`, `402-grid-2-sold-flash.png`, `402-grid-3-sold.png`.

## Recording notes

- Do not speak or zoom the invoice id.
- Do not show a retry. If Claude retries a claim, the server returns the original result marked "Already claimed ... this is the original result", with the same invoice, so nothing is double-claimed or double-invoiced.
- The claim route is rate limited (10 claims a minute per handle, 30 per connection). A normal take never hits it.

## Rehearse locally first

A local run needs PayPal sandbox credentials in your own environment for invoices; without them a first-claim sale cannot invoice. The flow is covered without the network by `src/mcp/integration.test.ts` (MCP client → real routes → claim → SENT with pay link → retry → Backup 1 → PAID, PayPal faked) and `src/mcp/payment.test.ts` (402-style body, refresh route, await_payment).

```sh
PORT=8796 DATA_DIR=$(mktemp -d) node --import tsx src/server.ts     # then create the sale on http://localhost:8796/new
DIBS_BASE_URL=http://localhost:8796 node scripts/mcp-smoke.mjs list_sale '{"sale":"<slug>"}'
```
