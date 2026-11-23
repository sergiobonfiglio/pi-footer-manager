import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitlabMrFragment } from "../footer-manager/gitlab-mr.ts";

test("falls back to matching HEAD SHA across MR pages", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mr-test-"));
  const oldPath = process.env.PATH;
  const sha = "a".repeat(40);
  try {
    writeFileSync(join(dir, "git"), `#!/bin/sh\necho ${sha}\n`);
    writeFileSync(join(dir, "glab"), `#!/bin/sh\ncase "$*" in\n  *--source-branch*) echo '[]';;\n  *'--page 1'*) printf '['; i=0; while [ $i -lt 100 ]; do [ $i -gt 0 ] && printf ','; printf '{}'; i=$((i+1)); done; echo ']';;\n  *) echo '[{"sha":"${sha}","iid":42,"web_url":"https://example.com/mr/42"}]';;\nesac\n`);
    chmodSync(join(dir, "git"), 0o755); chmodSync(join(dir, "glab"), 0o755);
    process.env.PATH = `${dir}:${oldPath}`;
    const env = { ctx: { cwd: dir }, footerData: { getGitBranch: () => "feature", onBranchChange: () => () => {} }, invalidate: () => {} };
    const fragment = createGitlabMrFragment(env as any);
    try {
      for (let i = 0; i < 100 && !fragment.render(80, {} as any); i++) await new Promise(resolve => setTimeout(resolve, 20));
      assert.match(fragment.render(80, {} as any), /!42/);
    } finally { fragment.dispose?.(); }
  } finally { process.env.PATH = oldPath; rmSync(dir, { recursive: true, force: true }); }
});
