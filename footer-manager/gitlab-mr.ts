import { execFile } from "node:child_process";
import type { FooterRenderEnv, FooterFragmentComponent } from "./types.ts";

/** Optional fragment: refresh in the background and never block footer rendering. */
export function createGitlabMrFragment(env: FooterRenderEnv): FooterFragmentComponent {
  let branch = "";
  let text = "";
  let generation = 0;
  let disposed = false;
  const refresh = () => {
    const current = env.footerData.getGitBranch() || "";
    branch = current;
    text = "";
    const request = ++generation;
    env.invalidate();
    if (!current) return;
    const links: string[] = [];
    let branchMatches = 0;
    const fetchPage = (page: number, sha?: string) => execFile("glab", ["mr", "list", "--all", ...(sha ? [] : ["--source-branch", current]), "--output", "json", "--per-page", "100", "--page", String(page)], { cwd: env.ctx.cwd, timeout: 15000 }, (error, stdout) => {
      if (disposed || request !== generation) return;
      try {
        if (error) throw error;
        const items = JSON.parse(stdout);
        if (!Array.isArray(items)) throw new Error("Invalid MR list");
        if (!sha) branchMatches += items.length;
        links.push(...items.filter((item: any) => !sha || item.sha === sha).flatMap((item: any) => {
          const url = item.web_url;
          const iid = item.iid;
          if (typeof url !== "string" || !/^https?:\/\/[^\s\x00-\x1f\x7f]+$/.test(url) || !Number.isInteger(iid)) return [];
          return [`\x1b]8;;${url}\x1b\\\x1b[4m!${iid}\x1b[24m\x1b]8;;\x1b\\`];
        }));
        if (items.length === 100) { fetchPage(page + 1, sha); return; }
        if (!sha && branchMatches === 0) {
          execFile("git", ["rev-parse", "HEAD"], { cwd: env.ctx.cwd, timeout: 15000 }, (gitError, head) => {
            if (disposed || request !== generation) return;
            const revision = head.trim();
            if (!gitError && /^[0-9a-f]{40,64}$/i.test(revision)) fetchPage(1, revision);
          });
          return;
        }
        text = links.join(", ");
      } catch { text = ""; }
      env.invalidate();
    });
    fetchPage(1);
  };
  const unsubscribe = env.footerData.onBranchChange(refresh);
  refresh();
  return {
    render: () => branch === (env.footerData.getGitBranch() || "") ? text : "",
    dispose: () => { disposed = true; generation++; unsubscribe(); },
  };
}
