import { buildSessionContext, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { basename } from "node:path";
import type { FooterFragmentRegistration, FooterRenderEnv } from "./types.ts";

export type BuiltInFragmentsOptions = {
  getSeparator: () => string;
};

function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "0";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return `${Math.round(tokens)}`;
}

function formatCost(cost: number): string {
  if (!Number.isFinite(cost) || cost <= 0) return "$0.000";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

function formatModelRate(rate: unknown): string {
  const value = Number(rate) || 0;
  if (value === 0) return "0";
  if (Math.abs(value) < 0.01) return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function collapseHome(cwd: string): string {
  const home = homedir();
  return home && (cwd === home || cwd.startsWith(home + "/")) ? `~${cwd.slice(home.length)}` : cwd;
}

function shortenDirectory(name: string, targetWidth: number): string {
  const characters = Array.from(name);
  const originalWidth = visibleWidth(name);
  let shortest = name;

  for (let sideLength = Math.floor((characters.length - 1) / 2); sideLength >= 2; sideLength--) {
    const candidate = `${characters.slice(0, sideLength).join("")}..${characters.slice(-sideLength).join("")}`;
    const candidateWidth = visibleWidth(candidate);
    if (candidateWidth >= originalWidth) continue;
    shortest = candidate;
    if (candidateWidth <= targetWidth) return candidate;
  }

  return shortest;
}

export function shortenPath(path: string, maxWidth: number): string {
  const targetWidth = Math.max(0, Math.floor(maxWidth));
  let overflow = visibleWidth(path) - targetWidth;
  if (overflow <= 0) return path;

  const parts = path.split(/([/\\]+)/);
  for (let index = 0; index < parts.length && overflow > 0; index += 2) {
    const name = parts[index] ?? "";
    const originalWidth = visibleWidth(name);
    const shortened = shortenDirectory(name, Math.max(0, originalWidth - overflow));
    const reduction = originalWidth - visibleWidth(shortened);
    if (reduction <= 0) continue;
    parts[index] = shortened;
    overflow -= reduction;
  }

  return parts.join("");
}

export function shortenPathForFooter(path: string, regionWidth: number, totalWidth: number): string {
  const maxWidth = Math.min(Math.max(0, Math.floor(regionWidth)), Math.floor(Math.max(0, totalWidth) / 2));
  return shortenPath(path, maxWidth);
}

export function lastDirectory(cwd: string): string {
  return basename(cwd) || cwd;
}

function compactModel(ctx: ExtensionContext): string {
  const model = ctx.model;
  const id = typeof model?.id === "string" ? model.id : "no-model";
  const provider = typeof model?.provider === "string" ? model.provider : undefined;
  const base = id.split("/").filter(Boolean).pop() || id;
  if (!provider) return base;
  return id.toLowerCase().includes(provider.toLowerCase()) ? base : `${provider}/${base}`;
}

function renderModelCost(ctx: ExtensionContext): string {
  const cost = ctx.model?.cost;
  if (!cost) return "";
  return `↑$${formatModelRate(cost.input)} ↓$${formatModelRate(cost.output)}`;
}

function renderModelCacheCost(ctx: ExtensionContext): string {
  const cost = ctx.model?.cost;
  if (!cost) return "";
  const read = Number(cost.cacheRead) || 0;
  const write = Number(cost.cacheWrite) || 0;
  if (read === 0 && write === 0) return "";
  return `R${formatModelRate(read)} W${formatModelRate(write)}`;
}

function getBranchAssistantUsage(ctx: ExtensionContext): { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number } {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  try {
    for (const entry of ctx.sessionManager.getBranch()) {
      if ((entry as any).type !== "message") continue;
      const message = (entry as any).message;
      if (message?.role !== "assistant") continue;
      const usage = message.usage;
      totals.input += Number(usage?.input) || 0;
      totals.output += Number(usage?.output) || 0;
      totals.cacheRead += Number(usage?.cacheRead) || 0;
      totals.cacheWrite += Number(usage?.cacheWrite) || 0;
      totals.cost += Number(usage?.cost?.total) || 0;
    }
  } catch {}
  return totals;
}

function getSessionCost(ctx: ExtensionContext): number {
  let total = 0;
  try {
    for (const entry of ctx.sessionManager.getEntries()) {
      const item = entry as any;
      let usage;
      if (item.type === "message" && (item.message?.role === "assistant" || item.message?.role === "toolResult")) {
        usage = item.message.usage;
      } else if ((item.type === "compaction" || item.type === "branch_summary") && item.usage) {
        usage = item.usage;
      }
      total += Number(usage?.cost?.total) || 0;
    }
  } catch {}
  return total;
}

function getCacheHit(ctx: ExtensionContext): { hitPercent: number; cacheRead: number; cacheWrite: number } | undefined {
  const { input, cacheRead, cacheWrite } = getBranchAssistantUsage(ctx);
  if (cacheRead === 0 && cacheWrite === 0) return undefined;
  const denominator = input + cacheRead;
  const hitPercent = denominator > 0 ? Math.round((cacheRead / denominator) * 100) : 0;
  return { hitPercent, cacheRead, cacheWrite };
}

function renderCacheHit(ctx: ExtensionContext): string {
  const cache = getCacheHit(ctx);
  return cache ? `cache ${cache.hitPercent}%` : "";
}

function renderCacheHitCounts(ctx: ExtensionContext): string {
  const cache = getCacheHit(ctx);
  return cache ? `cache ${cache.hitPercent}% R${formatTokens(cache.cacheRead)}/W${formatTokens(cache.cacheWrite)}` : "";
}

function getThinkingLevel(ctx: ExtensionContext): string {
  try {
    const context = buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId());
    return context.thinkingLevel || "off";
  } catch {
    return "off";
  }
}

function getContextInfo(ctx: ExtensionContext): { percentage: number; used?: number; total?: number } {
  try {
    const contextWindow = Number(ctx.model?.contextWindow) || 0;
    if (contextWindow <= 0) return { percentage: 0 };
    const context = buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId());
    const lastAssistant = [...context.messages].reverse().find((m: any) => m.role === "assistant" && m.stopReason !== "aborted") as any;
    const usage = lastAssistant?.usage;
    if (!usage) return { percentage: 0, used: 0, total: contextWindow };
    const used = (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
    return { percentage: (used / contextWindow) * 100, used, total: contextWindow };
  } catch {
    return { percentage: 0 };
  }
}

function renderContextGauge(ctx: ExtensionContext, theme: Theme): string {
  const { percentage, used, total } = getContextInfo(ctx);
  const width = 8;
  const clamped = Math.max(0, Math.min(100, percentage));
  const filled = Math.round((clamped / 100) * width);
  const color = clamped >= 90 ? "error" : clamped >= 70 ? "warning" : clamped >= 50 ? "accent" : "success";
  const bar = theme.fg(color, "━".repeat(filled)) + theme.fg("dim", "─".repeat(width - filled));
  const counts = used !== undefined && total ? ` ${formatTokens(used)}/${formatTokens(total)}` : "";
  return `${theme.fg("dim", "ctx ")}${bar} ${theme.fg("dim", `${Math.round(clamped)}%${counts}`)}`;
}

export function createBuiltInFragments(options: BuiltInFragmentsOptions): FooterFragmentRegistration[] {
  return [
    { id: "cwd.full", label: "CWD", component: ({ ctx, theme }: FooterRenderEnv) => ({ render: () => theme.fg("accent", collapseHome(ctx.cwd || process.cwd())) }) },
    { id: "cwd.shortened", label: "Shortened CWD", component: ({ ctx, theme }: FooterRenderEnv) => ({ render: (width, totalWidth) => theme.fg("accent", shortenPathForFooter(collapseHome(ctx.cwd || process.cwd()), width, totalWidth)) }) },
    { id: "cwd.last", label: "Last CWD directory", component: ({ ctx, theme }: FooterRenderEnv) => ({ render: () => theme.fg("accent", lastDirectory(ctx.cwd || process.cwd())) }) },
    { id: "git.branch", label: "Git branch", component: ({ footerData, theme }: FooterRenderEnv) => ({ render: () => { const branch = footerData.getGitBranch(); return branch ? theme.fg("success", branch) : ""; } }) },
    { id: "git.branch.shortened", label: "Shortened Git branch", component: ({ ctx, footerData, theme }: FooterRenderEnv) => ({ render: (width, totalWidth) => { const branch = footerData.getGitBranch(); return branch && branch !== lastDirectory(ctx.cwd || process.cwd()) ? theme.fg("success", shortenPathForFooter(branch, width, totalWidth)) : ""; } }) },
    { id: "model.name", label: "Model", component: ({ ctx, theme }: FooterRenderEnv) => ({ render: () => theme.fg("muted", compactModel(ctx)) }) },
    { id: "model.cost", label: "Model cost", component: ({ ctx, theme }: FooterRenderEnv) => ({ render: () => theme.fg("dim", renderModelCost(ctx)) }) },
    { id: "model.cacheCost", label: "Model cache cost", component: ({ ctx, theme }: FooterRenderEnv) => ({ render: () => theme.fg("dim", renderModelCacheCost(ctx)) }) },
    { id: "cache.hit", label: "Cache hit", component: ({ ctx, theme }: FooterRenderEnv) => ({ render: () => theme.fg("dim", renderCacheHit(ctx)) }) },
    { id: "cache.hit_counts", label: "Cache hit with counts", component: ({ ctx, theme }: FooterRenderEnv) => ({ render: () => theme.fg("dim", renderCacheHitCounts(ctx)) }) },
    { id: "thinking.level", label: "Thinking", component: ({ ctx, theme }: FooterRenderEnv) => ({ render: () => theme.fg("accent", getThinkingLevel(ctx)) }) },
    { id: "context.gauge", label: "Context", component: ({ ctx, theme }: FooterRenderEnv) => ({ render: () => renderContextGauge(ctx, theme) }) },
    { id: "cost.total", label: "Total cost", component: ({ ctx, theme }: FooterRenderEnv) => ({ render: () => theme.fg("dim", formatCost(getSessionCost(ctx))) }) },
    { id: "statuses", label: "Statuses", component: ({ footerData, theme }: FooterRenderEnv) => ({ render: () => Array.from(footerData.getExtensionStatuses().values()).filter(Boolean).join(theme.fg("dim", options.getSeparator())) }) },
  ];
}
