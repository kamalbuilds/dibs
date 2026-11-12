# Dibs MCP: 28-second agentic claim demo

The story: a buyer hands a seller's claim-sale post to their AI assistant. The assistant reads the binder, claims the card, and PayPal sends a Goods & Services invoice in the same step. The buyer pays as a guest, and the assistant confirms it is PAID. Money moment by 0:20.

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
| 0:06 to 0:14 | `claim` tool call, then the result line "#01 Irene Adler ($26.00): First · server time ..." and "PayPal invoice ...: SENT, $27.76 ... pay at https://www.sandbox.paypal.com/invoice/p/#INV2-..." next to the binder tab, where the pocket stamps CLAIMED live | VO: "It calls dibs. The Dibs server timestamps it first, and PayPal sends a Goods and Services invoice in the same step." |
| 0:14 to 0:22 | Click the pay link; sandbox invoice; pay as a guest with the test Visa; PayPal "Paid" confirmation | VO: "I pay the PayPal invoice, with buyer protection." |
| 0:22 to 0:28 | Back in Claude: "Did it go through?", then `invoice_status`, then "...: PAID, $27.76. Paid on PayPal."; the binder pocket shows PAID | VO: "The agent confirms it's paid. If I hadn't paid, it would roll to the backup." |

### Exact prompts

1. Paste, as one message:

   > Here's a claim sale: "Conan Doyle singles, claims open now → https://dibs-claims.fly.dev/s/&lt;slug&gt;". Grab Irene Adler for me as @kamal_demo, invoice to &lt;sandbox buyer email&gt;.

2. After paying: "Did it go through?"

### Expected tool calls and outputs

**1. `list_sale`** `{ "sale": "https://dibs-claims.fly.dev/s/<slug>" }`

```
Conan Doyle singles (https://dibs-claims.fly.dev/s/<slug>)
Claims open until <deadline>. 1 of 1 pockets open.
#01 Irene Adler · $26.00 · OPEN
Buyer handles are private; backup counts only.
```

**2. `claim`** `{ "sale": "<slug>", "itemNumbers": [1], "handle": "@kamal_demo", "email": "<sandbox buyer email>" }`

Claude may ask you to confirm first (the tool description tells it to). Answer "yes".

```
Claim received for @kamal_demo on "Conan Doyle singles".
#01 Irene Adler ($26.00): First · server time 2026-11-12T...Z
PayPal invoice <id>: SENT, $27.76, due <24h later>, pay at https://www.sandbox.paypal.com/invoice/p/#INV2-...
Next:
- PayPal has emailed a Goods & Services invoice to <sandbox buyer email>. Pay it before the due time or the item rolls to the next backup.
- Check progress any time with invoice_status.
```

The total is the $26.00 item, plus the sale's shipping tier, plus the buyer's half of the G&S fee when the fee is split. It reads $27.76 with $1.00 shipping; with other defaults the number differs, so say "the invoice" rather than the amount in VO. The structured result carries `invoices[0].status = "SENT"` and `invoices[0].payUrl`.

**3. Pay.** Click the pay link. On the PayPal sandbox invoice page choose to pay by **debit or credit card** (guest), and use the sandbox test Visa: `4111 1111 1111 1111`, any future expiry, any CVV, any name and US address. If PayPal rejects it, generate a Visa in the PayPal Developer dashboard (Testing tools, Card generator).

**4. `invoice_status`** `{ "sale": "<slug>", "handle": "kamal_demo" }` (the server remembers the invoice id from the claim in this session)

```
PayPal invoice status for @kamal_demo.
Invoice <id> for @kamal_demo: PAID, $27.76 (items $26.00 + shipping $1.00 + fee $0.76). Paid on PayPal. PayPal invoice: https://www.sandbox.paypal.com/invoice/p/#INV2-...
```

Dibs reads PayPal every 15 seconds, so PAID can lag the PayPal confirmation by up to 15 seconds. If the first answer still says SENT, ask again. In the edit, hold on the PayPal confirmation and cut on the update.

## Recording notes

- Do not speak or zoom the invoice id.
- Do not show a retry. If Claude retries a claim, the server returns the original result marked "Already claimed ... this is the original result", with the same invoice, so nothing is double-claimed or double-invoiced.
- The claim route is rate limited (10 claims a minute per handle, 30 per connection). A normal take never hits it.

## Rehearse locally first

A local run invoices through the PayPal sandbox credentials in your own environment. The flow is covered without the network by `src/mcp/integration.test.ts` (MCP client → real routes → claim → SENT with pay link → retry → Backup 1 → PAID, with PayPal's HTTP API served in memory).

```sh
PORT=8796 DATA_DIR=$(mktemp -d) node --import tsx src/server.ts     # then create the sale on http://localhost:8796/new
DIBS_BASE_URL=http://localhost:8796 node scripts/mcp-smoke.mjs list_sale '{"sale":"<slug>"}'
```
