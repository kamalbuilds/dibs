// Operator command to keep a standing sale open longer, e.g. the judge demo binder.
// On the server: node scripts/extend-sale.mjs <slug> <ISO date>
import { getSaleBySlug } from "../dist/store.js";
import { extendDeadline } from "../dist/service.js";

const [slug, until] = process.argv.slice(2);
const closesAtMs = Date.parse(until ?? "");
if (!slug || Number.isNaN(closesAtMs)) { console.error("usage: node scripts/extend-sale.mjs <slug> <ISO date>"); process.exit(2); }
const sale = getSaleBySlug(slug);
if (!sale) { console.error(`${slug}: no such sale`); process.exit(1); }
const extended = extendDeadline(sale.id, closesAtMs);
console.log(`${slug}: "${extended.title}" now closes ${new Date(extended.closes_at_ms).toISOString()}`);
