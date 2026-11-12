import { expect, it } from "vitest";
import { groupRollovers } from "./rollover.ts";

const e = (type: string, at_ms: number) => ({ id: `${type}-${at_ms}`, type, at_ms, payload: "{}" });

it("folds a cancel, the promoted backup and its new invoice into one rollover", () => {
  const groups = groupRollovers([e("claim_received", 1), e("invoice_cancelled", 100), e("backup_promoted", 101), e("invoice_started", 102), e("invoice_paid", 200)]);
  expect(groups.map((g) => g.kind)).toEqual(["event", "rollover", "event"]);
  const roll = groups[1];
  expect(roll.kind === "rollover" && roll.promoted.length).toBe(1);
  expect(roll.kind === "rollover" && roll.reinvoiced?.type).toBe("invoice_started");
});

it("keeps a cancel with no backup as a rollover that reopens the item", () => {
  const groups = groupRollovers([e("invoice_cancelled", 10), e("item_reopened", 11)]);
  expect(groups).toHaveLength(1);
  expect(groups[0].kind === "rollover" && groups[0].reopened.length).toBe(1);
});
