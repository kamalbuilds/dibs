Claim: A sandbox invoice can move DRAFT -> SENT -> CANCELLED and a read-back can prove each terminal state before Dibs releases an item to its backup.
Verdict: UNTESTED. `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `SMOKE_BUYER_EMAIL` are empty.
Measured: No sandbox request was sent. Official current PayPal Invoicing v2 docs confirm POST create, POST send, GET read, and POST cancel endpoints and their lifecycle: https://developer.paypal.com/api/invoicing/v2/ and https://developer.paypal.com/invoicing/reference/.
Negative case: Not run against PayPal. The completed smoke script must exit 2 when credentials are missing and fail if any read-back status differs from SENT or CANCELLED.
Caveat: the PayPal docs quick start describes a sent invoice as UNPAID, while the supplied API map expects SENT. The client and reconciler must accept both as outstanding; only PAID and CANCELLED are terminal outcomes for this loop.
Blocks product: yes for a verified live money loop. The implementation can be completed, but the product cannot be reported PROVEN until sandbox credentials are supplied and `npm run smoke` observes the terminal post-conditions.
