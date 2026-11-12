// @vitest-environment jsdom
import { expect, it, vi } from "vitest";

const sale = { id: "sale1", slug: "binder", title: "Friday binder", status: "OPEN", closes_at_ms: Date.now() + 3_600_000 };
const item = { id: "item1", number: 1, title: "Dr. Watson", price_cents: 2500, status: "OPEN", comps: null };
const docket = { sale, items: [item], claims: [], invoices: [], events: [] };

async function renderDocket(comps: boolean) {
  vi.resetModules();
  vi.stubGlobal("EventSource", class { static CLOSED = 2; readyState = 1; onopen = null; onerror = null; addEventListener() {} close() {} });
  vi.stubGlobal("fetch", async (path: string) => new Response(JSON.stringify(path === "/api/config" ? { missing: [], comps, demoBuyerEmail: null, aiModel: "m", paypalEnvironment: "sandbox" } : docket)));
  localStorage.setItem("dibs-owner:sale1", "k");
  document.body.innerHTML = '<div id="root"></div>';
  history.pushState(null, "", "/dash/sale1");
  await import("./main.tsx");
  await vi.waitFor(() => expect(document.querySelector('.ag-header-cell[col-id="title"]')).not.toBeNull(), { timeout: 15000 });
  await new Promise((resolve) => setTimeout(resolve, 300));
  return {
    columns: [...document.querySelectorAll(".ag-header-cell[col-id]")].map((node) => node.getAttribute("col-id")),
    compsButton: [...document.querySelectorAll("button")].some((button) => button.textContent?.includes("Price comps")),
  };
}

it("shows the Comps column and Price comps button only when the server has Channel3", async () => {
  const on = await renderDocket(true);
  expect(on.columns).toContain("comps");
  expect(on.compsButton).toBe(true);
  const off = await renderDocket(false);
  expect(off.columns).toContain("title");
  expect(off.columns).not.toContain("comps");
  expect(off.compsButton).toBe(false);
}, 60000);
