import { execFile } from "node:child_process";
import type { FooterRenderEnv, FooterFragmentComponent } from "./types.ts";

export function jiraKey(branch: string): string {
  return branch.match(/(?:^|[^A-Za-z0-9])([A-Za-z][A-Za-z0-9]+-\d+)(?![A-Za-z0-9])/i)?.[1]?.toUpperCase() ?? "";
}

export function jiraUrl(result: any, source: "twg" | "acli", key: string): string {
  const data = Array.isArray(result?.data) ? result.data.find((item: any) => item?.key === key) : result?.data;
  const raw = source === "twg" ? data?.url : result?.self;
  if (typeof raw !== "string" || /[\x00-\x20\x7f-\x9f]/.test(raw)) return "";
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    if (source === "acli") {
      if (!/^\/rest\/api\/\d+\/issue\/[^/]+\/?$/.test(url.pathname)) return "";
      return `${url.origin}/browse/${encodeURIComponent(key)}`;
    }
    return url.href;
  } catch { return ""; }
}

export function jiraLink(text: string, url: string): string {
  return text && url ? `\x1b]8;;${url}\x1b\\\x1b[4m${text}\x1b[24m\x1b]8;;\x1b\\` : text;
}

export function jiraField(env: FooterRenderEnv, field: "key" | "title" | "status"): FooterFragmentComponent {
  let branch = "", text = "", generation = 0, disposed = false;
  const refresh = () => {
    branch = env.footerData.getGitBranch() || "";
    const key = jiraKey(branch), request = ++generation;
    text = field === "key" ? key : "";
    env.invalidate();
    if (!key) return;
    const options = { cwd: env.ctx.cwd, timeout: 15000, env: { ...process.env, TWG_AGENT_DEFAULTS: "1" } };
    const finish = (error: Error | null, stdout: string, source: "twg" | "acli") => {
      if (disposed || request !== generation) return;
      try {
        const result = error ? null : JSON.parse(stdout);
        const data = source === "twg" ? (Array.isArray(result?.data) ? result.data.find((item: any) => item?.key === key) : result?.data) : result?.fields;
        const value = field === "key" ? key : field === "title" ? data?.summary : data?.status?.name;
        const visible = typeof value === "string" ? value.replace(/[\x00-\x1f\x7f-\x9f]/g, " ") : "";
        text = field === "key" ? jiraLink(visible, jiraUrl(result, source, key)) : visible;
      } catch { text = field === "key" ? key : ""; }
      env.invalidate();
    };
    execFile("twg", ["jira", "workitem", "get", key, "-o", "json", "--output-summary", "none"], options, (error, stdout) => {
      if (disposed || request !== generation) return;
      if (error && "code" in error && error.code === "ENOENT") {
        execFile("acli", ["jira", "workitem", "view", key, "--json", "--fields", "summary,status"], options, (fallbackError, fallbackOutput) => finish(fallbackError, fallbackOutput, "acli"));
      } else finish(error, stdout, "twg");
    });
  };
  const unsubscribe = env.footerData.onBranchChange(refresh);
  const timer = field === "status" ? setInterval(refresh, 10 * 60 * 1000) : undefined;
  timer?.unref();
  refresh();
  return { render: () => branch === (env.footerData.getGitBranch() || "") ? text : "", dispose: () => { disposed = true; generation++; clearInterval(timer); unsubscribe(); } };
}
