import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { app, runReconciler } from "./routes.js";
import "./store.js";

if (process.env.NODE_ENV === "production" && existsSync("./web/dist")) {
  app.use("/*", serveStatic({ root: "./web/dist" }));
  app.get("*", serveStatic({ root: "./web/dist", path: "./web/dist/index.html" }));
} else app.notFound((c) => c.json({ error: "Route not found" }, 404));

const port = Number(process.env.PORT || 8787);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Dibs listening on ${info.port}`);
  void runReconciler().catch((error) => console.error("Initial reconcile failed", error instanceof Error ? error.message : error));
});

const timer = setInterval(() => {
  void runReconciler().catch((error) => console.error("Scheduled reconcile failed", error instanceof Error ? error.message : error));
}, 15_000);

function shutdown() {
  clearInterval(timer);
  server.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
