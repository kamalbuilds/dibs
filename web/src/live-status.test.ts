import { describe, expect, it } from "vitest";
import { soldAnnouncement, soldTransitions } from "./live-status.ts";

const row = (id: string, status: string) => ({ id, status, number: `#0${id}`, title: `Card ${id}`, buyer: "@ana" });

describe("soldTransitions", () => {
  it("reports rows that just became paid, not ones already paid or new to the grid", () => {
    const previous = new Map([["1", "INVOICED"], ["2", "PAID"], ["3", "CLAIMED"]]);
    const changes = soldTransitions(previous, [row("1", "PAID"), row("2", "PAID"), row("3", "INVOICED"), row("4", "PAID")]);
    expect(changes.map((change) => change.id)).toEqual(["1"]);
    expect(soldAnnouncement(changes)).toBe("#01 Card 1 sold to @ana");
  });
  it("is quiet on the first render", () => {
    expect(soldTransitions(null, [row("1", "PAID")])).toEqual([]);
  });
});
