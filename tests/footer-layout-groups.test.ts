import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Node's type stripping does not support the manager's parameter property.
const hook = registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith("/footer-manager/index.ts")) {
    return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText };
  }
  return nextLoad(url, context);
} });
const { default: footerManager } = await import("../footer-manager/index.ts");
hook.deregister();
import { FOOTER_MANAGER_REGISTER_FRAGMENT } from "../footer-manager/types.ts";

function setup(fragments: unknown[], align = "left", separator = " | ") {
  const handlers = new Map<string, Function>();
  const events = new Map<string, Function>();
  const settings = { footerManager: { layout: { separator, rows: [{ regions: [{ align, fragments }] }] } } };
  const stub = mock.method(SettingsManager, "create", () => ({
    getProjectSettings: () => settings, getGlobalSettings: () => ({}), drainErrors: () => [],
  }) as any);
  let footer: any;
  const pi = { on: (name: string, fn: Function) => handlers.set(name, fn), events: {
    on: (name: string, fn: Function) => { events.set(name, fn); return () => {}; }, emit: () => {},
  } };
  footerManager(pi as any);
  const ctx = { cwd: "/tmp", hasUI: true, ui: { notify: () => {}, setFooter: (factory: Function) => {
    if (factory) footer = factory({ requestRender() {} }, { fg: (_: string, text: string) => text }, { onBranchChange: () => () => {} });
  } } };
  try { handlers.get("session_start")!({}, ctx); } finally { stub.mock.restore(); }
  const register = (id: string, text: string) => events.get(FOOTER_MANAGER_REGISTER_FRAGMENT)!({ id, component: () => ({ render: () => text }) });
  return { render: (width: number) => footer.render(width) as string[], register };
}

test("groups concatenate literals and fragments, with separators only between nonempty groups", () => {
  const footer = setup([[{ text: "[" }, "a", { text: "]" }], "empty", { text: "literal\nline" }, ["b", { text: "!" }]]);
  footer.register("a", "A"); footer.register("b", "B"); footer.register("empty", "");
  assert.deepEqual(footer.render(35), ["[A] | literal line | B!".padEnd(35)]);
});

test("overflow removes whole groups from the right for left alignment and from the left for right alignment", () => {
  for (const [align, expected] of [["left", "[A]  "], ["right", "  [B]"]]) {
    const footer = setup([[{ text: "[" }, "a", { text: "]" }], [{ text: "[" }, "b", { text: "]" }]], align);
    footer.register("a", "A"); footer.register("b", "B");
    assert.deepEqual(footer.render(5), [expected]);
  }
});

test("groups hide custom literals when all their fragments are empty", () => {
  const footer = setup(["a", ["empty", { text: " / custom / " }, "missing"], "b"]);
  footer.register("a", "A"); footer.register("b", "B"); footer.register("empty", "");
  assert.deepEqual(footer.render(30), ["A | B".padEnd(30)]);
  footer.register("empty", "E");
  assert.deepEqual(footer.render(30), ["A | E / custom /  | B".padEnd(30)]);
});

test("a single oversized literal group is truncated without adding a separator", () => {
  const footer = setup([[{ text: "abcdefgh" }]], "left", " :: ");
  const line = stripVTControlCharacters(footer.render(4)[0]);
  assert.equal(line.length, 4);
  assert.ok(!line.includes("::"));
  assert.ok(line.startsWith("a"));
});
