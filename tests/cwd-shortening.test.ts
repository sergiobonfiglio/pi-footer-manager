import assert from "node:assert/strict";
import test from "node:test";
import { createBuiltInFragments, shortenPath, shortenPathForFooter } from "../footer-manager/built-ins.ts";

test("leaves a path unchanged when it fits", () => {
  const path = "/short/path";
  assert.equal(shortenPath(path, path.length), path);
});

test("replaces the middle of a long directory symmetrically", () => {
  const path = "/very-long-directory-name/next";
  const expected = "/very-long..tory-name/next";
  assert.equal(shortenPath(path, expected.length), expected);
});

test("exhausts each directory before shortening the next", () => {
  const path = "/very-long-directory-name/another-long-directory";
  const expected = "/ve..me/another-..irectory";
  assert.equal(shortenPath(path, expected.length), expected);
});

test("does not add an ellipsis to names that would not get shorter", () => {
  const path = "/abcde/another-long-directory";
  const expected = "/abcde/another-..irectory";
  assert.equal(shortenPath(path, expected.length), expected);
});

test("keeps at least two characters on each side", () => {
  assert.equal(shortenPath("/abcdefg", 7), "/ab..fg");
  assert.equal(shortenPath("/very-long-directory-name/another-long-directory", 1), "/ve..me/an..ry");
});

test("preserves path separators and the collapsed home marker", () => {
  assert.equal(shortenPath("~/very-long-directory-name", 10), "~/ver..ame");
  assert.equal(shortenPath("C:\\very-long-directory-name\\next", 16), "C:\\ver..ame\\next");
});

test("shortens adaptive paths when they exceed half of the footer width", () => {
  assert.equal(shortenPathForFooter("/very-long-directory-name", 100, 50), "/very-long-directory-name");
  assert.equal(shortenPathForFooter("/very-long-directory-name", 100, 48), "/very-long-..ctory-name");
});

test("renders only the last directory in cwd.last", () => {
  const registration = createBuiltInFragments({ getSeparator: () => " > " }).find(({ id }) => id === "cwd.last")!;
  const component = registration.component({
    ctx: { cwd: "/work/project" },
    theme: { fg: (_color: string, text: string) => text },
  } as any);
  assert.equal(component.render(100, 100), "project");
});

test("shortens and conditionally hides git.branch.shortened", () => {
  const registration = createBuiltInFragments({ getSeparator: () => " > " }).find(({ id }) => id === "git.branch.shortened")!;
  const render = (cwd: string, branch: string) => registration.component({
    ctx: { cwd },
    footerData: { getGitBranch: () => branch },
    theme: { fg: (_color: string, text: string) => text },
  } as any).render(100, 20);

  assert.equal(render("/work/project", "project"), "");
  assert.equal(render("/work/project", "very-long-branch-name"), "very..name");
});
