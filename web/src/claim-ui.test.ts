// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import { ClaimConfirmation, type ClaimResult } from "./claim-ui.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = () => {};
window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;

const base: ClaimResult = { handle: "qa_sheet", email: "buyer@example.com", receiptId: "inv-1", invoiceSent: true, lines: [{ item: { id: "i1", number: 1, title: "Irene Adler", priceCents: 2600 }, kind: "claim", position: 0, atMs: Date.UTC(2026, 10, 12, 18, 0, 0, 123) }] } as ClaimResult;

async function render(result: ClaimResult) {
  document.body.innerHTML = "<div></div>";
  const root = createRoot(document.body.firstElementChild!);
  await act(async () => root.render(createElement(MemoryRouter, null, createElement(ClaimConfirmation, { result, onDismiss: () => {} }))));
  const text = document.body.textContent ?? "";
  await act(async () => root.unmount());
  return text;
}

it("tells a buyer a repeated claim is the original one, with no new PayPal invoice", async () => {
  const fresh = await render(base);
  expect(fresh).toContain("CLAIM RECEIVED");
  expect(fresh).not.toMatch(/Already yours/);
  const replay = await render({ ...base, replayed: true });
  expect(replay).toContain("Already yours");
  expect(replay).toContain("No new PayPal invoice");
  expect(replay).not.toContain("CLAIM RECEIVED");
});
