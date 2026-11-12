import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";

export function mountWeb(app: Hono, root = "./web/dist"): void {
  app.use("/*", serveStatic({ root }));
  app.get("*", serveStatic({ root, path: "index.html" }));
}
