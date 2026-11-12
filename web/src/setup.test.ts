// @vitest-environment jsdom
import { expect, it, vi } from "vitest";

it("shows the sandbox buyer email from /api/config on the setup page", async () => {
  document.body.innerHTML = '<div id="root"></div>';
  history.pushState(null, "", "/setup");
  vi.stubGlobal("fetch", async (path: string) => new Response(JSON.stringify(path === "/api/config"
    ? { missing: [], demoBuyerEmail: "sb-buyer@personal.example.com", aiModel: "m", paypalEnvironment: "sandbox" }
    : { ok: true, missing: [] })));
  await import("./main.tsx");
  await vi.waitFor(() => expect(document.body.textContent).toContain("sb-buyer@personal.example.com"));
});
