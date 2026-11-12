# Dibs

Dibs gives card, comic, and retro game sellers a timestamped claim queue for social sales. Buyers claim items by number, backups keep their place in the queue, and confirmed winners can receive bundled PayPal Goods and Services invoices. The server stores claim events and invoice transitions in SQLite.

OpenRouter vision turns seller photos into item suggestions and shows the label text it read on each item, and ranks each title by how well that label backs it, so the seller sees at a glance which pockets to check. Comment threads paste in exactly as copied from X, Instagram, or Discord, header lines and all: the model returns the line number of each comment, and Dibs quotes the raw text from the paste and checks that the handle is visible above it. Sellers confirm imported claims and item matches before they enter the invoice flow. Prices remain seller-entered.

## Run locally

Use Node 24 or newer. Copy `.env.example` to `.env`, then add PayPal sandbox credentials and an OpenRouter API key when you want to use those integrations. The server starts without credentials and reports which ones are missing at `/api/health`.

```sh
npm install
node --env-file-if-exists=.env --import tsx src/server.ts
```

The server defaults to port 8787. Set `PORT` to use another port and `DATA_DIR` to select the SQLite directory. Set `PAYPAL_ENV=sandbox` for sandbox invoices. `npm run smoke` exercises the real sandbox cancellation and backup invoice flow when PayPal credentials and `SMOKE_BUYER_EMAIL` are configured.

## API path

Create a sale with `POST /api/sales`, add seller-confirmed items through `POST /api/sales/:id/items`, then publish with `POST /api/sales/:id/publish`. The create response contains the seller key. Send it as `x-seller-key` on seller routes. Buyers claim at `POST /api/sales/:id/claims` (a repeat of the same handle, email and items returns the original claims with `replayed: true`; the route allows 30 claims a minute per client IP and 10 per handle per sale, answering 429 with `Retry-After`, tunable with `CLAIM_RATE_PER_IP`, `CLAIM_RATE_PER_HANDLE`, `CLAIM_RATE_WINDOW_MS`, 0 to turn off); public sale state is available at `/api/public/sales/:slug`, and live changes stream from `/api/events?saleId=<sale-id>` using Server-Sent Events. A seller can close claims at `POST /api/sales/:id/close` to create and send bundled PayPal invoices.

## Judge it in one minute

Dibs runs live at https://dibs-claims.fly.dev against the PayPal sandbox.

1. **Try the live sale.** The home page opens a live binder of 25 Conan Doyle Characters cigarette cards (Boguslavsky, 1923). One public-domain photo went through the AI itemizer, and every pocket shows its own server-side crop. Claim a pocket there, or start your own sale below.
2. **Start a sale.** Press **New sale** (`/new`), name the sale, pick a claim window (5 minutes is enough for a demo), keep the shipping and Goods and Services fee defaults, and press **Create sale**.
3. **Fill the binder.** Choose up to four photos and press **Review photos** for AI itemization. The model boxes every item, Dibs crops each one into its pocket, and each row shows the label the AI read ("AI read PAPERBOY on the item"). Click a pocket photo to replace it. Or press **Add item by hand**. Set a price on every pocket and press **Publish sale**. Dibs opens the seller docket at `/dash/<sale id>`.
4. **Claim as a buyer.** Open the public binder link shown on the docket (`/s/<slug>`) in a second tab. Tap a pocket, enter any handle, and use the PayPal sandbox buyer email printed under the email field (it is also on `/setup`). Press **Claim**. The pocket stamps your handle with the server timestamp, and the docket row fills in live over Server-Sent Events.
5. **Invoice.** On the docket, press **Send PayPal invoices**. Each buyer gets one bundled Goods and Services invoice with the shipping tier applied, and the invoice list shows it as SENT with its total and a link to the PayPal sandbox invoice page.
6. **Pay.** Open that link, log in as the sandbox buyer, and pay. The reconciler reads the invoice from PayPal every 15 seconds; once PayPal reports PAID, the pocket flips to PAID on the buyer page and the AG Grid docket.
7. **Ship.** Press **Ship** on the paid row and enter the carrier and tracking number. Dibs reads the payment's PayPal transaction id from the invoice, attaches the tracker to that transaction on PayPal, reads it back as SHIPPED, and the docket row and buyer receipt both show **Tracking on PayPal**. Tracking on the PayPal transaction is what Seller Protection checks for proof of delivery.

**Holds.** A buyer who ticks **Hold with 20% deposit** gets an invoice with that deposit as the minimum due now (the seller sets the percentage). Once PayPal reports the deposit received, Dibs marks it HELD and keeps the item for that buyer past the claim deadline instead of passing it to a backup.

**The fee line.** When the seller splits the Goods and Services fee or passes it on, the PayPal invoice carries it as its own line, "G&S fee (split)" or "G&S fee (buyer pays)", so the buyer sees exactly what the protected payment costs them.

To bring claims in from a comment thread, open `/import/<sale id>` from the docket, paste the replies as copied, press **Parse comments**, pick an item where two match, add buyer emails, and confirm. The claims land in the same timestamped queue, backups included.

`npm run smoke` runs the other half of the money loop against the real sandbox: an unpaid invoice passes its deadline, Dibs cancels it on PayPal, and the backup claimant receives a fresh invoice.

## PayPal and AI

Dibs uses PayPal Invoicing v2 for invoice creation (including deposit invoices with a minimum due), sending, reminders, cancellation, and readback, and Shipment Tracking v1 (`/v1/shipping/trackers`) to attach tracking to the paid transaction. The polling reconciler runs every 15 seconds; webhook signatures are checked through PayPal's verification endpoint when `PAYPAL_WEBHOOK_ID` is configured. OpenRouter chat completions use JSON Schema output validated by Zod before the server accepts suggestions.

**Price comps from Channel3.** After the AI itemizes a photo, Dibs searches Channel3 for each item by its AI-read title and shows real store listings in the review grid and the docket: lowest, median, and up to three source links in USD. Listings whose titles do not name the item and Tukey outliers are left out, an empty search reads "No comps", and **Use median** fills the price for the seller to confirm. Set `CHANNEL3_API_KEY` to turn it on; **Price comps** on the docket reruns a whole sale.

## Claim from an AI assistant (MCP)

Dibs ships an MCP server so Claude Desktop, Claude Code, Cursor, or any MCP client can run a claim end to end: read the binder, claim pockets for the buyer, and follow the PayPal invoice. It is a thin layer over the same HTTP API the binder uses, so every rule (claim deadline, duplicate claims, timestamp order, backups, PayPal invoicing and rollover) is still decided by the Dibs server.

| Tool | What it does |
| --- | --- |
| `list_sale` | Sale slug or link → every pocket with number, title, price, status, whether it can be claimed, backup count, photo URL, and the deadline. Read-only. |
| `claim` | Sale, pocket numbers (or a claim comment such as `mine 3 and 7`), handle, email, optional deposit hold → **First** or **Backup N** per pocket with the server timestamp, the PayPal invoice when the sale invoices on first claim (SENT, total, pay link), and what happens next. Retrying the same claim returns the original result. |
| `invoice_status` | Invoice id, or sale + handle → PayPal state, total with item/shipping/fee lines, deposit, due time, pay link, tracking, and whether an unpaid item rolled to a backup. Reads Dibs' copy of the invoice, synced from PayPal every 15 seconds. |

It also exposes a `dibs://sale/{slug}` resource and a `claim_from_post` prompt (paste a seller's X / Instagram / Discord post and what you want).

### Judge quickstart (about 2 minutes)

Needs Node 24+ and Claude Desktop (or Cursor / Claude Code, below). Paste into a terminal:

```sh
git clone -b grok-mcp-dibs https://github.com/kamalbuilds/dibs.git && cd dibs
npm ci && npm run build
node scripts/mcp-smoke.mjs list_sale '{"sale":"kJ4emW4"}'   # optional: proves it reaches the live Dibs API, read-only
cat <<JSON
{
  "mcpServers": {
    "dibs": {
      "command": "$(command -v node)",
      "args": ["$(pwd)/dist/mcp/main.js"],
      "env": { "DIBS_BASE_URL": "https://dibs-claims.fly.dev" }
    }
  }
}
JSON
```

Merge the printed JSON into Claude Desktop's config (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`, Windows: `%APPDATA%\Claude\claude_desktop_config.json`) and restart Claude Desktop. Or, for Claude Code: `claude mcp add dibs -- node "$(pwd)/dist/mcp/main.js"`.

First prompt, read-only:

> What's in this claim sale, and what's still open? https://dibs-claims.fly.dev/s/kJ4emW4

To see an agent claim become a PayPal invoice, create your own sale on https://dibs-claims.fly.dev/new with **Invoice timing: After each first claim**, publish it, then:

> Here's a claim sale: https://dibs-claims.fly.dev/s/&lt;your slug&gt;. Claim pocket 1 for me as @judge_demo, invoice to &lt;sandbox buyer email from /setup&gt;.

The reply carries the server timestamp, the SENT PayPal invoice and its pay link; pay it as a sandbox guest, then ask "Did it go through?". Please claim only on your own sale, not on the demo binder. Dibs calls PayPal Invoicing v2 server-side; the MCP server does not use the PayPal Agent Toolkit or PayPal's MCP server, and never holds PayPal credentials.

Environment:

- `DIBS_BASE_URL`: Dibs instance to talk to. Defaults to `https://dibs-claims.fly.dev`.
- `DIBS_SELLER_KEY` (optional): a sale's seller key. Adds buyer handles to `list_sale` queues and lets `invoice_status` look up any buyer by handle. Buyers never need it; without it `invoice_status` works by invoice id or for invoices claimed in the same session.

Run it:

```sh
npm install
npm run mcp            # stdio, from source
npm run mcp:http       # Streamable HTTP at http://127.0.0.1:8790/mcp (stateless)
npm run build && npm run mcp:start   # stdio from dist/mcp/main.js
node scripts/mcp-smoke.mjs list_sale '{"sale":"kJ4emW4"}'   # spawn the server and call a tool
```

**Claude Desktop** (`claude_desktop_config.json`, after `npm run build`):

```json
{
  "mcpServers": {
    "dibs": {
      "command": "node",
      "args": ["/absolute/path/to/dibs/dist/mcp/main.js"],
      "env": { "DIBS_BASE_URL": "https://dibs-claims.fly.dev" }
    }
  }
}
```

**Claude Code:**

```sh
claude mcp add dibs -e DIBS_BASE_URL=https://dibs-claims.fly.dev -- node /absolute/path/to/dibs/dist/mcp/main.js
```

**Cursor** (`.cursor/mcp.json` in this repo, or `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "dibs": {
      "command": "node",
      "args": ["${workspaceFolder}/dist/mcp/main.js"],
      "env": { "DIBS_BASE_URL": "https://dibs-claims.fly.dev" }
    }
  }
}
```

Or point any client that speaks Streamable HTTP at a running `npm run mcp:http`: `{ "mcpServers": { "dibs": { "url": "http://127.0.0.1:8790/mcp" } } }`.

[docs/mcp-demo.md](docs/mcp-demo.md) has a 30-second demo script against the live sale.

## Render

Create a Render web service from this repository using `render.yaml`. Configure PayPal sandbox credentials and `OPENROUTER_API_KEY` in the service environment. Render mounts persistent SQLite storage at `/var/data`.
