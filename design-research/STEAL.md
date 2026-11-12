# Dibs: what we steal

## Visual thesis

Dibs looks like a card-show table with an open binder page on it: off-white paper, black ink, one hot claim-red accent, items in numbered 5:7 pockets, prices in tabular monospace, and the claim timestamp printed as large as the price, because the timestamp decides who wins.

## Tokens to adopt

| Token | Value | Taken from |
|---|---|---|
| Paper background | `#F6F3EC` (off-white, warmer than TCGplayer `#FFFFFF`) | TCGplayer, eBay, Card Ladder all use pure white; Dibs warms it so the page reads as paper, not a web page |
| Ink | `#111111` text, `#5E636C` secondary | Card Ladder ink `#09090B`; TCGplayer secondary `rgb(94,99,108)` = `#5E636C` |
| Claim red (one accent, one job: marks claimed and overdue) | `#D7261E` | eBay reserves red for urgency text only; Whatnot's solid red "Live" corner badge |
| Pocket ratio | 5:7, image at full tile width | Collectr tiles; X claim sale binder photos (3x3 pockets) |
| Pocket number | `#07` style, fixed width, top-left corner block | TCGplayer collector numbers `#004/102`; Whatnot top-left badge placement |
| Price stack | claim price large, "market $x" 13px secondary underneath | TCGplayer price + "Market Price" 13.33px line; Collectr price over delta |
| Numbers | tabular monospace, right-aligned in tables | AG Grid right-aligned "$12,749" column |
| Label over value | tiny caps label (11px, airy tracking) over bold value | Card Ladder "Date Sold / Dec 21, 2023" |
| Grid row height | 40px (AG Grid demo measures 42px; snapped to the 8px scale) | AG Grid |
| Row gutter | item number in the AG Grid row number gutter | AG Grid |
| Selected or overdue row | flat tint, no border or shadow | Card Ladder pale selected-row tint |
| Chip active state | ink filled, inactive paper with 1px ink-at-15% border | Whatnot black active chip (14px, padding 8px 16px) |
| Radius | 4px on inputs and pockets, no pills | AG Grid inputs 4px; avoid Collectr 10 to 12px and Whatnot pills |
| Spacing | 8px scale | AG Grid padding and row steps |

## Hero moment

A buyer taps pocket `#07`. The pocket stamps claim-red with their handle and a time to the second ("@mika 6:31:04 PM"), and the next buyer who taps it is told "Claimed 2s ago. You are backup #1." The timestamp is the proof, so it is the biggest thing in the stamp. On the seller grid the same row fills in Buyer and Claimed at as it happens.

## Copy for the 5 key buttons and states

1. Claim button on an open pocket: **Claim #07**
2. Pocket already claimed: **Claimed by @mika at 6:31:04 PM. Get in line as backup?** with the button **Back me up**
3. Seller sends invoices: **Send PayPal invoices (12 buyers)**
4. Invoice waiting on payment: **Invoice sent. Due by 6:31 PM tomorrow (23h 12m left).**
5. Unpaid claim passes on: **Not paid in time. #07 went to backup @jules.**
