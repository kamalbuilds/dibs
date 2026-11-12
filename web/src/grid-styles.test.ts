import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

// The docket grid is styled by the Theming API (themeQuartz passed as `theme`). Loading the legacy
// ag-grid.css / ag-theme-*.css on top makes two styling systems fight; checkboxes then render as an icon-font glyph.
it("loads one AG Grid styling system: the Theming API, with no legacy stylesheets", () => {
  const dir = join(import.meta.dirname, ".");
  const sources = readdirSync(dir).filter((name) => /\.(tsx?|css)$/.test(name) && !name.endsWith(".test.ts")).map((name) => [name, readFileSync(join(dir, name), "utf8")] as const);
  expect(sources.some(([, text]) => /theme=\{[^}]*\}/.test(text) && text.includes("themeQuartz"))).toBe(true);
  const legacy = sources.filter(([, text]) => /ag-grid-community\/styles\/|\.ag-theme-[a-z]/.test(text)).map(([name]) => name);
  expect(legacy).toEqual([]);
});
