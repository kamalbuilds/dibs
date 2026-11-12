# Dibs design references

Captured with `refshot.py` in the signed-in `deepsurge` profile on 2026-11-12. Every value cited below comes from the `.tokens.json` beside each PNG. Replaced: PriceCharting (Cloudflare "just a moment" on the card page, 0 chars rendered on the NES game page).

## TCGplayer (direct competitor)

- URL: https://www.tcgplayer.com/search/pokemon/product?q=charizard&productLineName=pokemon
- Screen: product search results for "charizard" in Pokemon, 382 results, 4-up grid of card tiles. This is the price page a buyer checks before claiming.
- Screenshots: `design-research/refs/tcgplayer-1440.png`, `design-research/refs/tcgplayer-390.png` (mobile shows a "Shipping to India" modal over the grid, with the grid visible behind it)
- Measured: html bg `#FFFFFF`; body Inter 16px/24px, color `rgb(55,64,71)`; results header Inter 13.33px, tracking -0.23px, black; secondary text (set, rarity, "Market Price Unavailable") 13.33px/17.33px `rgb(94,99,108)`; links `rgb(8,53,219)`; tab buttons Inter 12.8px weight 700, padding 12px 8px, radius 0px; search input radius 8px, border 1px solid `rgb(212,215,226)`, padding 8px 16px 8px 48px. Loaded fonts: Inter only. Page height 3130px.
- Rows and regions: a filter chip row (Condition, Printing, Set, Rarity) above a "382 results" line and a sort dropdown. Each tile has the card scan on the left and text on the right: name in bold, then set, rarity and collector number ("Base Set, Holo Rare, #004/102"), then "N listings from", a big bold lowest price with a small "USD", and a green "Market Price: $646.39" line. A solid black "Out of Stock" pill replaces the price when no listings exist.
- Steal:
  1. Two prices per item: the asking price large, the market reference small underneath. Dibs claim tiles should show the seller price plus a quiet "market $x" line, so buyers trust the price.
  2. Collector-number grammar `#004/102`. Dibs tile numbers (`#07`) should use the same short, fixed-width numbering.
  3. The black "Out of Stock" pill is a strong, flat sold state. Dibs "Claimed" can use a flat ink block the same way, but in claim red.
- Avoid: Inter everywhere, blue links, and green money text. Three colors that each mean something different read as a generic marketplace.

## eBay (direct competitor)

- URL: https://www.ebay.com/sch/i.html?_nkw=pokemon+card+lot
- Screen: search results grid for "pokemon card lot" (100,000+ results), with a left facet rail and a 4-column grid of listings. This is where Dibs sellers sell today when they are not running claim sales.
- Screenshots: `design-research/refs/ebay-1440.png` (full page, 9726px tall), `design-research/refs/ebay-390.png`
- Measured: fonts Market Sans and Roboto; results heading Market Sans 14px weight 400 `rgb(25,25,25)`; links 11px `rgb(9,104,246)`; small buttons 11px, radius 8px, padding 4px, white bg; search input radius 44px 0 0 44px (pill), white. Page height 9726px.
- Rows and regions: the left rail lists facets with counts in small grey brackets ("Base Set (6,698)"). Chip rows cover buying format and popular filters. Each listing tile is a square photo with a heart and a carousel dots row, then the title (2 lines, clamped), condition ("Pre-Owned"), a bold price, "Buy It Now" or "or Best Offer", "+$56.11 delivery", the location, and an urgency line in red ("Last one", "Save up to 15%").
- Steal:
  1. Square photo first, text block under it, every tile the same height. Seller phone photos of cards sit well in a square crop, which suits Dibs numbered tiles.
  2. Social-proof lines in plain words ("507 sold", "113 watchers"). Dibs can show "3 waiting" for backup claimers in the same quiet register.
  3. Red is reserved for urgency text only. Dibs claim red should have that single job too.
- Avoid: the facet rail with counts and the sponsored store banner. Dibs sale pages are one seller's table, not a search engine, so filters add nothing.

## Whatnot (direct competitor)

- URL: https://www.whatnot.com/category/trading_card_games
- Screen: the live-show browse page for Trading Card Games, showing a grid of shows that are live right now with viewer counts. This is the incumbent for live card selling.
- Screenshots: `design-research/refs/whatnot-1440.png` (full page, 6228px), `design-research/refs/whatnot-390.png`
- Measured: body bg `#FFFFFF`, text `#000000`, body font system-ui (no web font loaded); chip buttons 14px weight 400, padding 8px 16px, fully round radius (1.67772e+07px, i.e. pill); Follow and Log in buttons in a flat yellow. Page height 6228px. The page heading "Trading Card Games" renders at roughly 28px (read off the 1440 PNG) in a thin regular weight.
- Rows and regions: a sub-category strip (Pokemon 26.1K viewers, One Piece 1.8K) with a black filled chip for the active tab (Recommended) and grey chips for the rest. A 4-up grid where each tile has the seller avatar and handle on top, a tall 3:4 thumbnail with a red "Live . 1.9k" badge in the top left, then a 2-line uppercase show title and a blue category link plus tags ("$1 Starts, Sudden death").
- Steal:
  1. Small solid-red live badge with a count, pinned to the photo's top-left corner. Dibs claim tiles can carry the claim marker the same way: a red corner block on the photo, not a border around the whole tile.
  2. Seller handle above each tile. On Dibs, buyers know sellers by handle, so the sale header should lead with the seller handle, not a logo.
  3. Black filled chip for the active state, grey for inactive, no outline. One rule, easy to read.
- Avoid: the thumbnails are seller-made posters (giant italic "$50 MILLION INVENTORY"), and together they are visual noise. Dibs tiles show the actual card photo and nothing else.

## X claim-sale post, Sleepy Troll's Trading Co. (direct competitor: the manual workflow Dibs replaces)

- URL: https://x.com/TrollBJ0RN/status/2120295558904709295
- Screen: a seller's pinned claim-sale rules post, then the sale itself as binder-page photos in the replies. This is how claim sales run today: comments are claims, and the seller's screen timestamp decides who wins.
- Screenshots: `design-research/refs/x-claimsale-1440.png` (full page; the lower half shows overlapping text from the full-page stitch, the top 1500px is clean), `design-research/refs/x-claimsale-390.png` (clean)
- Measured (390 tokens): body bg `#000000`, text `rgb(231,233,234)`; font TwitterChirp; "Post" header 22.5px weight 700; Follow button 15px, radius 9999px, padding 4px 16px, bg `rgb(29,155,240)`. Post body copy renders at about 15px on 20px leading.
- Rows and regions: the post is the whole rulebook, with numbered sections in caps. 1 HOW TO CLAIM: comment "Claim" or "Mine" plus card name or price. "First Come, First Served: The timestamp on my screen is the absolute final judge." "Claims Are BINDING." "Missed out? Comment Backup." 3 PAYMENT & INVOICING: day sales due 24 hours after the invoice DM, night sales due 12:00 PM EST the next day; past the deadline "cards immediately go to the backup claimer". Payment is Cash App, Venmo or PayPal (F&F). 5 SHIPPING: $1 PWE under $50 (max 3 cards), $7 BMWT for $50+, free BMWT at $150+. The images are binder pages of 9 pocket slots with cards in them.
- Steal:
  1. The binder page photo IS the sale. A 3x3 pocket grid with a number in each slot is the native layout buyers already read, so Dibs's sale page should be that grid.
  2. The seller's own words become Dibs product copy: "Claim", "Backup", "timestamp decides", "invoice due in 24h". Buyers already know these, so Dibs should not rename them.
  3. Shipping tiers as plain thresholds ($1 under $50, $7 over, free at $150). Dibs can show the buyer's running total against the next tier.
- Avoid: rules written as a wall of emoji bullets that buyers must read before acting. Dibs enforces the rules in the UI (timestamps on each claim, a countdown on each invoice) instead of posting them.

## Collectr (direct competitor: card price tracking)

- URL: https://app.getcollectr.com/
- Screen: the Explore product grid in the web app. Every tile is a card scan with its current market price and a 24h change, plus a filter rail (Watchlist, Product Type, Price Range, Language, Category).
- Screenshots: `design-research/refs/collectr-1440.png` (full page, 4665px), `design-research/refs/collectr-390.png`
- Measured: body bg lab(2.75) (about `#0A0A0A`), text lab(98.26) (about `#FAFAFA`); font Lato; section heading ("Find a Product") 18px weight 600; buttons 14px weight 400, radius 10px, padding 8px 12px; search input radius 12px, border 1px solid lab(21.7) (about `#333333`). Tiles are rounded dark panels with roughly 12px radius (read off the PNG), and the card art sits at the full tile width.
- Rows and regions: each tile shows the card scan (portrait 5:7), the name at about 18px, an underlined set link ("Delta Reign"), rarity and number ("Special Illustration Rare . 138/103"), finish ("Holofoil"), then the price "$306.38" with a red down triangle and the change on its own line ("-$43.62 (-12.46%)"), plus a circled plus button bottom right to add the card to a portfolio. On mobile the tiles go 2-up at the same density.
- Steal:
  1. The card scan at full tile width, uncropped, at the true 5:7 card ratio. Dibs tiles should hold the seller photo at 5:7 so a tile reads as a binder pocket.
  2. Price on one line, delta on a separate smaller line beneath. Dibs uses the same stack: claim price, then "market $x" small.
  3. One small corner action per tile (the circled plus). Dibs puts a single Claim action in the same spot, never a full-width button bar.
- Avoid: black background with teal accents and colored foil art everywhere. It reads as a crypto portfolio app, and Dibs should feel like paper on a table.

## Card Ladder (direct competitor: sales history)

- URL: https://app.cardladder.com/sales-history
- Screen: the Sales History route. Signed out, it shows a Pro upsell headline above an embedded product screenshot of the real sales table: rows of sold cards with date sold, sale type and price, and a detail panel on the right.
- Screenshots: `design-research/refs/cardladder-1440.png`, `design-research/refs/cardladder-390.png`
- Measured: body bg `#FFFFFF`, text `rgb(9,9,11)` (`#09090B`); h1 Poppins 48px weight 900, all caps, tracking normal; body copy Lato 16px; CTA button 16px weight 700, bg `rgb(52,190,139)` (`#34BE8B`), radius 7px, padding 0 20px. Loaded: Lato, Poppins, Material Icons. Left nav items in bold caps about 16px, with grey "PRO" tags.
- Rows and regions (from the embedded table): a "SALES" heading in heavy caps, then "97 results" with a filter tag. Each row has a small slab thumbnail, a tiny caps platform label ("PWCC PREMIER"), a 2-line card title, then three right-side columns with tiny caps labels over bold values: "Date Sold / Dec 21, 2023", "Type / Auction", "Price / $192,000.00". The selected row is tinted pale green. The detail panel shows Sold Price, Sold Date, CL Value and Pop in the same label-over-value pairs.
- Steal:
  1. Tiny caps label over a bold value ("Date Sold" above "Dec 21, 2023"). The Dibs claim log row uses this for "Claimed at" over the timestamp, so the time is the loudest field.
  2. Rows ordered by time with a date column always visible. In Dibs, the timestamp decides the winner, so it sits in a fixed column and is never hidden in a tooltip.
  3. The selected row is a flat tint, not a border or shadow. Dibs uses a pale claim-red tint on the row whose invoice is overdue.
- Avoid: Poppins 900 all-caps headlines and the mint-green upsell CTA everywhere. It is loud marketing type on a tool screen.

## AG Grid (dashboard pattern for the seller view)

- URL: https://www.ag-grid.com/example/
- Screen: the live performance demo: a 1,000 row by 22 column data grid with grouped column headers, a floating filter row, a checkbox column, a column tool panel and a row count footer. Dibs uses AG Grid for the seller dashboard, so this is the base it will be themed from.
- Screenshots: `design-research/refs/aggrid-1440.png` (1160px), `design-research/refs/aggrid-390.png`
- Measured: page bg `color(srgb 0.078 0.114 0.173)` (about `#141D2C`), body text about `#ACB5C2`; h1 32px weight 700 white; page font IBM Plex Sans (loaded); filter inputs radius 4px, border 1px solid white at 15%, bg `rgb(31,40,54)` (`#1F2836`); pill nav buttons 17px weight 500, radius 20px, padding 4px 12px. Grid row height 42px (measured on the 1440 PNG: rows at y 678, 720, 762 and so on); header group row and column header row about 48px each; numbers ("$12,749") right-aligned in their column.
- Rows and regions: a row group drop zone ("Drag here to set row groups"), a two-level header (Participant > Name, Language, Country; Game of Choice; Performance > Bank Balance), a floating filter input under each header, a row number gutter at the left (1, 2, 3), a selection checkbox and drag handle, then values. A right tool panel lists columns with checkboxes and a Pivot Mode toggle. The footer reads "Rows: 1,000".
- Steal:
  1. The row number gutter. Dibs item numbers (#01 to #60) go in that gutter, so the seller grid and the buyer binder share the same numbers.
  2. Right-aligned money in one column at 42px rows. That is dense enough to see a whole 60-item sale without scrolling far. Adopt 40px rows on 8px steps.
  3. A grouped header row: Item > #, Photo, Name; Claim > Buyer, Claimed at, Backup; Invoice > Status, Due. The groups follow the claim-to-invoice flow left to right.
- Avoid: the Quartz dark theme and the pivot/tool panel. The seller dashboard is a light paper grid, and Dibs has no use for pivot or row grouping.
