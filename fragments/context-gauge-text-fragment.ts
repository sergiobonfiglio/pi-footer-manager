import { buildSessionContext, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import {
  FOOTER_MANAGER_REGISTER_FRAGMENT,
  FOOTER_MANAGER_UNREGISTER_FRAGMENT,
  type FooterFragmentRegistration,
} from "../footer-manager/types";

const FRAGMENT_ID = "context.gauge.text";

function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "0";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return `${Math.round(tokens)}`;
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

function renderContextText(ctx: ExtensionContext, theme: Theme): string {
  const { percentage, used, total } = getContextInfo(ctx);
  const clamped = Math.max(0, Math.min(100, percentage));
  const color = clamped >= 90 ? "error" : clamped >= 70 ? "warning" : clamped >= 50 ? "accent" : "success";
  const counts = used !== undefined && total ? ` ${formatTokens(used)}/${formatTokens(total)}` : "";
  return `${theme.fg("dim", "ctx ")}${theme.fg(color, `${Math.round(clamped)}%`)}${theme.fg("dim", counts)}`;
}

export default function (pi: ExtensionAPI) {
  const registration: FooterFragmentRegistration = {
    id: FRAGMENT_ID,
    label: "Context (text)",
    component: ({ ctx, theme }) => ({
      render: () => renderContextText(ctx, theme),
    }),
  };

  pi.on("session_start", async () => {
    pi.events.emit(FOOTER_MANAGER_REGISTER_FRAGMENT, registration);
  });

  pi.on("session_shutdown", async () => {
    pi.events.emit(FOOTER_MANAGER_UNREGISTER_FRAGMENT, { id: FRAGMENT_ID });
  });
}
