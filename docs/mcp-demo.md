# Dibs MCP: 30-second agentic claim demo

The story: a buyer sees a seller's claim-sale post, hands it to their AI assistant, and the assistant claims the card, reports the server-timestamped result, and explains the PayPal invoice. All against the live sale at https://dibs-claims.fly.dev/s/kJ4emW4.

## Setup (before recording)

1. `npm install && npm run build`
2. Add the server to Claude Desktop, Claude Code or Cursor (snippets in the README, section "Claim from an AI assistant (MCP)"). Leave `DIBS_SELLER_KEY` unset: the demo is the buyer's view.
3. Open https://dibs-claims.fly.dev/s/kJ4emW4 in a browser next to the assistant so the pocket visibly stamps when the claim lands.
4. Pick a pocket that is still OPEN (the script uses **#22 Irene Adler, $26.00**) and a demo handle that has not claimed it yet. Use the PayPal sandbox buyer email from `/setup` so the invoice lands in sandbox.

Rehearse without touching the live sale: run Dibs locally (`PORT=8796 DATA_DIR=$(mktemp -d) node --import tsx src/server.ts`), create a sale on `http://localhost:8796/new`, and set `DIBS_BASE_URL=http://localhost:8796` for the MCP server.

## Script

**0:00 to 0:08. Read the binder.**

Prompt:

> Here's a claim sale from X: "Conan Doyle cigarette cards, Boguslavsky 1923, claims open now → https://dibs-claims.fly.dev/s/kJ4emW4". What's open, and what does Irene Adler cost?

Expected tool call: `list_sale { "sale": "https://dibs-claims.fly.dev/s/kJ4emW4" }`

Expected output (live, 12 Nov 2026):

```
Conan Doyle Characters, Boguslavsky 1923 (https://dibs-claims.fly.dev/s/kJ4emW4)
Claims open until 2026-12-21T12:00:00.000Z. 25 of 25 pockets open.
#01 Sherlock Holmes · $48.00 · OPEN
...
#22 Irene Adler · $26.00 · OPEN
...
Buyer handles are private; backup counts only.
```

The structured result also carries every pocket's photo URL, so the assistant can show the card.

**0:08 to 0:18. Claim it.**

Prompt:

> Claim Irene Adler for me. Handle @kamal_demo, invoice email <sandbox buyer email from /setup>.

Expected tool call: `claim { "sale": "kJ4emW4", "itemNumbers": [22], "handle": "@kamal_demo", "email": "<sandbox buyer email from /setup>" }`

Expected output (timestamp is the Dibs server's):

```
Claim received for @kamal_demo on "Conan Doyle Characters, Boguslavsky 1923".
#22 Irene Adler ($26.00): First · server time 2026-11-12T15:40:12.345Z
Next:
- One PayPal Goods & Services invoice for all your pockets goes to <sandbox buyer email from /setup> when the seller closes the sale (claims close 2026-12-21T12:00:00.000Z). Shipping and the fee line are added there.
- Check progress any time with invoice_status.
```

Point at the browser: pocket #22 flips to CLAIMED live. If someone already holds it, the same call answers `Backup 1` and explains that Dibs invoices the backup automatically when the first buyer does not pay.

**0:18 to 0:24. Show the server is in charge.**

Prompt:

> Claim it again.

Expected: the tool returns an error: `Dibs said: This handle already claimed the selected item (HTTP 409)`. The assistant cannot jump the queue or double-claim; the server decides.

**0:24 to 0:30. Follow the money.**

Prompt:

> When do I pay?

Expected tool call: `invoice_status { "sale": "kJ4emW4", "handle": "@kamal_demo" }`

Expected output before the seller closes the sale:

```
No invoice id is known for @kamal_demo yet. On "Conan Doyle Characters, Boguslavsky 1923" PayPal invoices go out when the seller closes the sale (claims close 2026-12-21T12:00:00.000Z) or right after a first claim, depending on the sale; ...
```

After the seller presses **Send PayPal invoices**, pass the id from the PayPal email or the Dibs receipt link (`invoice_status { "invoiceId": "<id>" }`) and the assistant reads back, for example:

```
Invoice 3ac78437-... for @kamal_demo: SENT, $27.76 (items $26.00 + shipping $1.00 + fee $0.76). Sent by PayPal, awaiting payment. PayPal invoice: https://www.sandbox.paypal.com/invoice/p/#INV2-...
```

## Optional extras

- The `claim_from_post` prompt does the whole flow from a pasted post: arguments `post`, `want`, `handle`, `email`.
- With the seller key set (`DIBS_SELLER_KEY`), `invoice_status` covers any buyer: due time while unpaid, the fee policy, deposit holds, tracking on PayPal, and "Invoice cancelled; rolled to backup @next" when an unpaid item moved on.

## A live claim is permanent

Dibs has no API to delete a claim, so a demo claim on kJ4emW4 stays in that pocket's queue (the seller can only pass it on at invoice time). Record against a local instance if the live binder must stay untouched, or claim a pocket the seller is happy to give the demo handle. `list_sale` and `invoice_status` are read-only and safe to run live any time.
