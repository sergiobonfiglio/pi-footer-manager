import assert from "node:assert/strict";
import test from "node:test";
import { renderUsage } from "../fragments/quota-footer-fragment-text.ts";

const theme = { fg: (_color: string, text: string) => text } as any;
const week = { label: "Week", usedPercent: 54, resetsIn: "4d22h" };

test("shows available Codex reset credits", () => {
  assert.equal(
    renderUsage({ provider: "Codex", windows: [week], resetCredits: 3, fetchedAt: 0 }, theme, " > "),
    "Codex > Week 54% 4d22h > 3⟳",
  );
});

test("omits Codex reset credits when none are available", () => {
  assert.equal(
    renderUsage({ provider: "Codex", windows: [week], fetchedAt: 0 }, theme, " > "),
    "Codex > Week 54% 4d22h",
  );
});
