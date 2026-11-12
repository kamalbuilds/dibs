import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { mountWeb } from "./static.js";

describe("web app fallback", () => {
  let root = "";
  afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = ""; });

  it("serves the client app at a deep browser route", async () => {
    root = mkdtempSync(join(tmpdir(), "dibs-web-"));
    writeFileSync(join(root, "index.html"), "<title>Dibs app shell</title>");
    const app = new Hono();
    mountWeb(app, root);

    const response = await app.request("/dash/sale-123");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Dibs app shell");
  });
});
