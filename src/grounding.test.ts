import { describe, expect, it } from "vitest";
import { groundVisionItem, groupByBuyer, linkThreadEvents } from "./domain.js";

const xPaste = ["Retro Rick", "@retrorick_", "·", "3m", "mine 2", "Pixel Jules", "@jules_plays", "·", "2m", "backup 2 please"];

describe("comment events link to the pasted source", () => {
  it("takes raw text from the paste, not from the model, across X-style header lines", () => {
    const linked = linkThreadEvents(xPaste, [
      { handle: "@retrorick_", line: 5, kind: "claim", itemRefs: [2], timestamp: "3m" },
      { handle: "jules_plays", line: 10, kind: "backup", itemRefs: [2], timestamp: "2m" },
    ]);
    expect(linked.map((event) => [event.handle, event.raw, event.line])).toEqual([["@retrorick_", "mine 2", 5], ["jules_plays", "backup 2 please", 10]]);
  });
  it("rejects a line outside the paste", () => {
    expect(() => linkThreadEvents(xPaste, [{ handle: "@retrorick_", line: 11, kind: "claim", itemRefs: [2], timestamp: null }])).toThrow(/outside/);
  });
  it("rejects events that break source order", () => {
    expect(() => linkThreadEvents(xPaste, [
      { handle: "@jules_plays", line: 10, kind: "backup", itemRefs: [2], timestamp: null },
      { handle: "@retrorick_", line: 5, kind: "claim", itemRefs: [2], timestamp: null },
    ])).toThrow(/order/);
  });
  it("rejects a handle that is not visible above its comment", () => {
    expect(() => linkThreadEvents(xPaste, [{ handle: "@invented", line: 5, kind: "claim", itemRefs: [2], timestamp: null }])).toThrow(/not visible/);
  });
});

describe("vision titles must be supported by text read off the item", () => {
  it("keeps confidence when the read label supports the title", () => {
    expect(groundVisionItem({ title: "Mario Bros.", read_text: "MARIO BROS.", confidence: 0.9 }).confidence).toBe(0.9);
    expect(groundVisionItem({ title: "Q*bert", read_text: "Q*bert", confidence: 0.8 }).confidence).toBe(0.8);
  });
  it("drops an unsupported title below the review threshold", () => {
    expect(groundVisionItem({ title: "Ice Hockey", read_text: "PAPERBOY", confidence: 0.7 }).confidence).toBe(0.5);
    expect(groundVisionItem({ title: "RBI Baseball", read_text: "", confidence: 0.9 }).confidence).toBe(0.5);
  });
});

describe("one invoice per buyer", () => {
  it("keeps two handles apart even when they share a PayPal email, and merges one handle across case", () => {
    const claims = [
      { handle: "@retrorick_", email: "buyer@example.com" },
      { handle: "@jules_plays", email: "buyer@example.com" },
      { handle: "@Jules_Plays", email: "BUYER@example.com" },
    ];
    expect(groupByBuyer(claims).map((group) => [group.handle, group.claims.length])).toEqual([["@retrorick_", 1], ["@jules_plays", 2]]);
  });
});
