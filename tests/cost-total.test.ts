import assert from "node:assert/strict";
import test from "node:test";
import { createBuiltInFragments } from "../footer-manager/built-ins.ts";

function renderTotalCost(entries: unknown[]): string {
  const registration = createBuiltInFragments({ getSeparator: () => " > " }).find(({ id }) => id === "cost.total")!;
  const component = registration.component({
    ctx: {
      sessionManager: {
        getEntries: () => entries,
        getBranch: () => { throw new Error("Total cost must include the whole session"); },
      },
    },
    theme: { fg: (_color: string, text: string) => text },
  } as any);
  return component.render(100, 100);
}

const usage = (cost: number) => ({ cost: { total: cost } });

test("includes delegated usage stored on tool results in total cost", () => {
  assert.equal(renderTotalCost([
    { type: "message", message: { role: "assistant", usage: usage(0.617332) } },
    { type: "message", message: { role: "toolResult", usage: usage(0.086388) } },
  ]), "$0.704");
});

test("includes compaction and branch-summary usage in total cost", () => {
  assert.equal(renderTotalCost([
    { type: "compaction", usage: usage(0.1) },
    { type: "branch_summary", usage: usage(0.2) },
  ]), "$0.300");
});
