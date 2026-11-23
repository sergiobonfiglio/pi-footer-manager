import { test } from "node:test";
import { strict as assert } from "node:assert";
import { jiraField, jiraKey, jiraLink, jiraUrl } from "../footer-manager/jira.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("guards and constructs Jira links", () => {
  const url = jiraUrl({ data: { url: "https://jira.example/browse/ABC-1" } }, "twg", "ABC-1");
  assert.equal(url, "https://jira.example/browse/ABC-1");
  assert.equal(jiraLink("ABC-1", url), `\x1b]8;;${url}\x1b\\\x1b[4mABC-1\x1b[24m\x1b]8;;\x1b\\`);
  assert.equal(jiraUrl({ data: [{ key: "RTAP-120", url: "https://dtonline.atlassian.net/browse/RTAP-120" }] }, "twg", "RTAP-120"), "https://dtonline.atlassian.net/browse/RTAP-120");
  assert.equal(jiraUrl({ data: [{ key: "OTHER-1", url }] }, "twg", "ABC-1"), "");
  assert.equal(jiraUrl({ self: "https://jira.example/rest/api/3/issue/123" }, "acli", "ABC-1"), url);
  for (const bad of ["javascript:alert(1)", "https://jira.example/\x1b]8;;evil", "https://user:pass@jira.example/"]) {
    assert.equal(jiraUrl({ data: { url: bad } }, "twg", "ABC-1"), "");
  }
  assert.equal(jiraUrl({ self: "https://jira.example/not-an-issue" }, "acli", "ABC-1"), "");
  assert.equal(jiraLink("ABC-1", ""), "ABC-1");
});

test("requests unsummarized JSON from twg even with agent defaults", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jira-twg-"));
  const originalPath = process.env.PATH;
  writeFileSync(join(dir, "twg"), `#!/bin/sh\n[ "$TWG_AGENT_DEFAULTS" = 1 ] || exit 1\n[ "$*" = 'jira workitem get RTAP-120 -o json --output-summary none' ] || { printf 'output_files: summary'; exit 0; }\nprintf '%s' '{"data":[{"key":"RTAP-120","url":"https://jira.example/browse/RTAP-120"}]}'\n`, { mode: 0o755 });
  process.env.PATH = dir;
  const env = { ctx: { cwd: dir }, footerData: { getGitBranch: () => "feature/RTAP-120", onBranchChange: () => () => {} }, invalidate: () => {} } as any;
  const component = jiraField(env, "key");
  try {
    const expected = jiraLink("RTAP-120", "https://jira.example/browse/RTAP-120");
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && component.render(80, 80) !== expected) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(component.render(80, 80), expected);
  } finally {
    component.dispose?.(); process.env.PATH = originalPath; rmSync(dir, { recursive: true, force: true });
  }
});

test("falls back to acli when twg is missing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jira-fallback-"));
  const originalPath = process.env.PATH;
  writeFileSync(join(dir, "acli"), `#!/bin/sh\n[ "$*" = 'jira workitem view RTAP-120 --json --fields summary,status' ] || exit 1\nprintf '%s' '{"self":"https://jira.example/rest/api/3/issue/123","fields":{"summary":"Example title","status":{"name":"In Progress"}}}'\n`, { mode: 0o755 });
  process.env.PATH = dir;
  const env = { ctx: { cwd: dir }, footerData: { getGitBranch: () => "feature/RTAP-120", onBranchChange: () => () => {} }, invalidate: () => {} } as any;
  const components = (["key", "title", "status"] as const).map(field => jiraField(env, field));
  try {
    const expected = [jiraLink("RTAP-120", "https://jira.example/browse/RTAP-120"), "Example title", "In Progress"];
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && components.some((component, i) => component.render(80, 80) !== expected[i])) await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(components.map(component => component.render(80, 80)), expected);
  } finally {
    components.forEach(component => component.dispose?.());
    process.env.PATH = originalPath;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("extracts Jira keys from branches", () => {
  assert.equal(jiraKey("feature/abc-123-description"), "ABC-123");
  assert.equal(jiraKey("ABC-42"), "ABC-42");
  assert.equal(jiraKey("feature/no-ticket"), "");
});
