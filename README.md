# Dibs

Dibs gives card, comic, and retro game sellers a timestamped claim queue for social sales. Buyers claim items by number, backups keep their place in the queue, and confirmed winners can receive bundled PayPal Goods and Services invoices. The server stores claim events and invoice transitions in SQLite.

OpenRouter vision turns seller photos into item suggestions, and OpenRouter parses copied comment threads into events linked to their original lines. Sellers confirm imported claims and item matches before they enter the invoice flow. Prices remain seller-entered.

## Run locally

Use Node 24 or newer. Copy `.env.example` to `.env`, then add PayPal sandbox credentials and an OpenRouter API key when you want to use those integrations. The server starts without credentials and reports which ones are missing at `/api/health`.

```sh
npm install
node --env-file-if-exists=.env --import tsx src/server.ts
```

The server defaults to port 8787. Set `PORT` to use another port and `DATA_DIR` to select the SQLite directory. Set `PAYPAL_ENV=sandbox` for sandbox invoices. `npm run smoke` exercises the real sandbox cancellation and backup invoice flow when PayPal credentials and `SMOKE_BUYER_EMAIL` are configured.

## API path

Create a sale with `POST /api/sales`, add seller-confirmed items through `POST /api/sales/:id/items`, then publish with `POST /api/sales/:id/publish`. The create response contains the seller key. Send it as `x-seller-key` on seller routes. Buyers claim at `POST /api/sales/:id/claims`; public sale state is available at `/api/public/sales/:slug`, and live changes stream from `/api/events?saleId=<sale-id>` using Server-Sent Events. A seller can close claims at `POST /api/sales/:id/close` to create and send bundled PayPal invoices.

## Judge it in one minute

Dibs runs live at https://dibs-claims.fly.dev against the PayPal sandbox.

1. **Start a sale.** Open the home page, name the sale, pick a claim window (5 minutes is enough for a demo), keep the shipping and Goods and Services fee defaults, and press **Create sale**.
2. **Fill the binder.** Choose up to four photos and press **Review photos** for AI itemization, or press **Add item by hand**. Set a price on every pocket and press **Publish sale**. Dibs opens the seller docket at `/dash/<sale id>`.
3. **Claim as a buyer.** Open the public binder link shown on the docket (`/s/<slug>`) in a second tab. Tap a pocket, enter any handle, and use the PayPal sandbox buyer email printed under the email field (it is also on `/setup`). Press **Claim**. The pocket stamps your handle with the server timestamp, and the docket row fills in live over Server-Sent Events.
4. **Invoice.** On the docket, press **Send PayPal invoices**. Each buyer gets one bundled Goods and Services invoice with the shipping tier applied, and the invoice list shows it as SENT with its total and a link to the PayPal sandbox invoice page.
5. **Pay.** Open that link, log in as the sandbox buyer, and pay. The reconciler reads the invoice from PayPal every 15 seconds; once PayPal reports PAID, the pocket flips to PAID on the buyer page and the AG Grid docket, and the row offers **Ship** for tracking.

`npm run smoke` runs the other half of the money loop against the real sandbox: an unpaid invoice passes its deadline, Dibs cancels it on PayPal, and the backup claimant receives a fresh invoice.

## PayPal and AI

Dibs uses PayPal Invoicing v2 for invoice creation, sending, reminders, cancellation, and readback. The polling reconciler runs every 15 seconds; webhook signatures are checked through PayPal's verification endpoint when `PAYPAL_WEBHOOK_ID` is configured. OpenRouter chat completions use JSON Schema output validated by Zod before the server accepts suggestions.

## Render

Create a Render web service from this repository using `render.yaml`. Configure PayPal sandbox credentials and `OPENROUTER_API_KEY` in the service environment. Render mounts persistent SQLite storage at `/var/data`.
