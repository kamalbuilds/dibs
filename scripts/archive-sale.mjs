// Operator command for sales whose seller key is gone: archives through the same service call as POST /api/sales/:id/archive.
// On the server: node scripts/archive-sale.mjs <slug> [<slug> ...]
import { getSaleBySlug } from "../dist/store.js";
import { archive } from "../dist/service.js";

const slugs = process.argv.slice(2);
if (!slugs.length) { console.error("usage: node scripts/archive-sale.mjs <slug> [<slug> ...]"); process.exit(2); }
for (const slug of slugs) {
  const sale = getSaleBySlug(slug);
  if (!sale) { console.error(`${slug}: no such sale`); process.exitCode = 1; continue; }
  const archived = archive(sale.id);
  console.log(`${slug}: "${archived.title}" archived at ${new Date(archived.archived_at_ms).toISOString()}`);
}
