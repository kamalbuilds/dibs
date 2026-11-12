# Dibs: claim sales that invoice themselves

PayPal API reference: `docs/PAYPAL-API.md`.

## Who
Card, comic and retro game sellers who run "claim sales" on X, Instagram and Discord. Verbatim from a seller's pinned rules (x.com/TrollBJ0RN/status/2120295558904709295): "Drop a 'Claim' or 'Mine' + card name", "The timestamp on my screen is the absolute final judge", "Payment is due within 24 hours of receiving your invoice DM", "cards immediately go to the backup claimer", "PayPal (F&F)". Today every step is manual and most take Friends & Family, which voids PayPal protection for both sides; the Goods & Services fee is a constant fight ("G&S add 3%").

## What it does (core loop, all real)
1. **Seller creates a sale**: uploads 1 to 4 photos of the items laid out (binder page, table, stack). AI vision returns every distinct item with a position number (left to right, top to bottom), title, set/platform, condition notes visible, and a confidence. Seller reviews a grid, edits titles, sets each price (AI may suggest a price range only when `PRICECHARTING_TOKEN` is set and a match is found; otherwise the price field is empty and required). Seller sets rules: claim deadline window (default 24 h, minimum 5 min so a demo can run end to end), shipping tiers (e.g. `$1 PWE under $50, max 3 items`, `$5 tracked mailer`, `free over $150`), fee policy (`seller absorbs`, `split`, `buyer pays`) with fee rate fields defaulting to PayPal's published US Goods & Services rate (look it up on paypal.com business fees page and cite the URL in a code comment; make it editable).
2. **Sale goes live** at `/s/:slug`: public page, numbered items, prices, live status per item (OPEN, CLAIMED, INVOICED, PAID, SHIPPED), backup queue length. Buyers claim by entering handle + email and tapping items, or typing "mine 3, 7". Server timestamps are the judge (monotonic, stored with ms). SSE pushes every change to all viewers.
3. **Import claims from a real comment thread**: seller pastes raw text copied from X/IG/Discord replies (handles, timestamps like "2m", "11:42 PM", text like "mine 3 and the zard", "backup 7", "pics of 4?"). AI extracts structured events `{handle, raw, kind: claim|backup|question|other, itemRefs: [number or title text], timestamp?}`. Deterministic resolver maps refs to items (by number, else fuzzy title match with threshold, else flagged "needs seller"), orders by timestamp then paste order, and shows a review table the seller confirms before anything is invoiced. Buyer emails for imported handles are entered by the seller (required for invoices).
4. **Close and invoice**: when the seller closes claiming (or per item on first claim, seller choice), Dibs builds one invoice per buyer bundling all items they won, applies the shipping tier rules and fee policy deterministically, creates and sends a PayPal invoice (Goods & Services, so both sides are protected), stores invoice id + payer link, reads back status SENT.
5. **Deadline engine**: a reconciler (every 15 s, plus `INVOICING.INVOICE.PAID` webhook when `PAYPAL_WEBHOOK_ID` is set) reads each SENT invoice. PAID: items flip to PAID. Deadline passed and still unpaid: cancel the invoice on PayPal (read back CANCELLED), release those items to the next backup in timestamp order, build and send that backup's invoice. No backup: item returns to OPEN. Every transition is an append-only event row and shows in a per-sale timeline.
6. **Ship**: seller enters carrier + tracking per paid buyer; Dibs records it and (when the buyer paid an invoice that produced a capture/transaction) attaches it where PayPal allows; at minimum it is stored and shown on the buyer's receipt page.
7. **Seller dashboard** `/dash/:saleId`: AG Grid Community table of all claims/invoices (buyer, items, subtotal, shipping, fee line, total, invoice status, deadline countdown, backup queue), with row actions (remind, cancel and pass to backup, mark shipped). Use AG Grid properly: column types, cell renderers for status chips and countdowns, quick filter, pinned totals row.

## AI usage (must be visible in the UI and the README)
- Vision itemization of sale photos (structured, zod-validated, confidence shown, low confidence items flagged).
- Comment thread parsing into claim events (structured, zod-validated, every extracted event links back to its raw line).
- Both are suggestions the seller confirms. Money moves only from confirmed, deterministic state.

## Deterministic rules with unit tests
- Claim ordering, ties, duplicate claims by the same handle, a claim after an item is taken becomes a backup.
- Ref resolution: "3", "#3", "no. 3", title fuzzy match, ambiguous, out of range.
- Bundling per buyer, shipping tier selection, fee policy math in cents (absorb/split/buyer pays), rounding.
- Deadline state machine: SENT→PAID, SENT→expired→CANCELLED→next backup invoiced, no backup→OPEN, webhook and poller racing (idempotent).

## Smoke (`npm run smoke`, real sandbox)
Creates a sale with two items via the store layer (no photo needed for smoke, items inserted through the same service functions the UI uses with seller-confirmed fields), registers buyer A (env `SMOKE_BUYER_EMAIL`) and buyer B as backup, sets deadline to 60 s, invoices A, reads SENT, waits past the deadline, asserts A's invoice reads CANCELLED on PayPal and B's invoice reads SENT on PayPal. Prints all invoice ids and statuses.

## One-minute judge path (README section "Judge it in one minute")
Open hosted URL → "Try a live sale" creates a sale from the judge's own photo (or the seller flow) → claim an item with the sandbox buyer email shown in the setup panel (`DEMO_BUYER_EMAIL`, set by the operator) → open the PayPal sandbox invoice link → pay → watch the item flip to PAID live on both the sale page and the AG Grid dashboard.

## Visual language
The card-show table and the binder page: off-white paper, black ink, one hot accent (claim red #E0301E or similar), numbered tiles like binder pockets, prices in a tabular monospace, timestamps shown prominently because the timestamp is the judge. Dense, fast, phone first for buyers; dashboard is desktop dense.

## Env (product specific)
`DEMO_BUYER_EMAIL` (sandbox personal account email shown to judges), `SMOKE_BUYER_EMAIL`, `PRICECHARTING_TOKEN` (optional).
