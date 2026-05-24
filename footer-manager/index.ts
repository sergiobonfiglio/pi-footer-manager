import {
  SettingsManager,
  type ExtensionAPI,
  type ExtensionContext,
  type ReadonlyFooterDataProvider,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { createBuiltInFragments } from "./built-ins.js";
import {
  FOOTER_MANAGER_INVALIDATE,
  FOOTER_MANAGER_REGISTER_FRAGMENT,
  FOOTER_MANAGER_UNREGISTER_FRAGMENT,
  type FooterFragmentComponent,
  type FooterFragmentRegistration,
  type FooterLayoutConfig,
  type FooterRegionAlign,
  type FooterRegionWidth,
  type FooterRenderEnv,
} from "./types.js";

type ValidLayout = Required<Pick<FooterLayoutConfig, "separator" | "rows">>;
type Region = ValidLayout["rows"][number]["regions"][number];
type WarnType = "info" | "warning" | "error";

type Entry = {
  registration: FooterFragmentRegistration;
  component?: FooterFragmentComponent;
};

const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
const UNKNOWN_FRAGMENT_WARNING_DELAY_MS = 3000;
const DEFAULT_LAYOUT: ValidLayout = {
  separator: " > ",
  rows: [
    {
      regions: [
        { width: 0.65, align: "left", fragments: ["cwd.full", "git.branch", "context.gauge"] },
        { width: 0.35, align: "right", fragments: ["model.name", "thinking.level", "statuses"] },
      ],
    },
  ],
};

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stripNewlines(text: string): string {
  return text.replace(/[\r\n]+/g, " ");
}

function padToWidth(line: string, width: number): string {
  return line + " ".repeat(Math.max(0, width - visibleWidth(line)));
}

function alignText(text: string, width: number, align: FooterRegionAlign): string {
  if (width <= 0) return "";
  const clipped = truncateToWidth(stripNewlines(text), width);
  const used = visibleWidth(clipped);
  const pad = Math.max(0, width - used);
  if (align === "right") return " ".repeat(pad) + clipped;
  if (align === "center") {
    const left = Math.floor(pad / 2);
    return " ".repeat(left) + clipped + " ".repeat(pad - left);
  }
  return clipped + " ".repeat(pad);
}

function isAutoWidth(width: FooterRegionWidth): width is "auto" {
  return width === "auto";
}

function numericWidth(width: FooterRegionWidth): number {
  return typeof width === "number" ? width : 0;
}

function allocateProportional(weights: number[], totalWidth: number): number[] {
  if (totalWidth <= 0) return weights.map(() => 0);
  const sum = weights.reduce((acc, width) => acc + Math.max(0, width), 0);
  if (sum <= 0) return weights.map(() => 0);
  const ideals = weights.map((width) => (Math.max(0, width) / sum) * totalWidth);
  const floors = ideals.map(Math.floor);
  let leftover = totalWidth - floors.reduce((acc, n) => acc + n, 0);
  const order = ideals
    .map((ideal, index) => ({ index, remainder: ideal - Math.floor(ideal) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const item of order) {
    if (leftover <= 0) break;
    floors[item.index]++;
    leftover--;
  }
  return floors;
}

function fitRightFirst(requested: number[], totalWidth: number): number[] {
  const widths = requested.map((width) => Math.max(0, Math.floor(width)));
  const target = Math.max(0, totalWidth);
  let overflow = widths.reduce((acc, width) => acc + width, 0) - target;
  for (let index = widths.length - 1; index >= 0 && overflow > 0; index--) {
    const cut = Math.min(widths[index] ?? 0, overflow);
    widths[index] = (widths[index] ?? 0) - cut;
    overflow -= cut;
  }
  const used = widths.reduce((acc, width) => acc + width, 0);
  const extra = target - used;
  if (extra > 0) {
    const index = widths.map((width, index) => ({ width, index })).filter((item) => item.width > 0).at(-1)?.index ?? widths.length - 1;
    if (index >= 0) widths[index] = (widths[index] ?? 0) + extra;
  }
  return widths;
}

function allocateWidths(regions: Region[], totalWidth: number, measureAuto: (region: Region) => number): number[] {
  if (totalWidth <= 0) return regions.map(() => 0);

  const hasAuto = regions.some((region) => isAutoWidth(region.width ?? "auto"));
  if (!hasAuto) return allocateProportional(regions.map((region) => numericWidth(region.width ?? "auto")), totalWidth);

  const fixedWeights = regions.map((region) => (isAutoWidth(region.width ?? "auto") ? 0 : numericWidth(region.width ?? "auto")));
  const fixedSum = fixedWeights.reduce((acc, width) => acc + width, 0);
  const fixedWidths = fixedSum > 1
    ? fitRightFirst(fixedWeights.map((width) => Math.ceil(width * totalWidth)), totalWidth)
    : allocateProportional(fixedWeights, Math.min(totalWidth, Math.round(fixedSum * totalWidth)));
  const remaining = Math.max(0, totalWidth - fixedWidths.reduce((acc, width) => acc + width, 0));

  const autoRequests = regions.map((region) => (isAutoWidth(region.width ?? "auto") ? Math.max(0, Math.ceil(measureAuto(region))) : 0));
  const autoWidths = fitRightFirst(autoRequests, remaining);
  return regions.map((region, index) => (isAutoWidth(region.width ?? "auto") ? autoWidths[index] ?? 0 : fixedWidths[index] ?? 0));
}

class FooterManager {
  private ctx?: ExtensionContext;
  private tui?: TUI;
  private theme?: Theme;
  private footerData?: ReadonlyFooterDataProvider;
  private layout: ValidLayout = DEFAULT_LAYOUT;
  private entries = new Map<string, Entry>();
  private persistedRegistrations = new Map<string, FooterFragmentRegistration>();
  private warned = new Set<string>();
  private unknownWarned = new Set<string>();
  private pendingUnknownWarnings = new Set<string>();
  private unsubscribers: Array<() => void> = [];
  private renderQueued = false;

  constructor(private readonly pi: ExtensionAPI) {}

  start(ctx: ExtensionContext): void {
    this.listen();
    this.disposeComponents();
    this.entries.clear();
    this.ctx = ctx;
    this.warned.clear();
    this.unknownWarned.clear();
    this.pendingUnknownWarnings.clear();
    this.loadLayout();
    this.registerBuiltIns();
    for (const registration of this.persistedRegistrations.values()) this.register(registration, false);

    if (!ctx.hasUI) return;

    ctx.ui.setFooter((tui, theme, footerData) => {
      this.tui = tui;
      this.theme = theme;
      this.footerData = footerData;
      const unsubBranch = footerData.onBranchChange(() => this.invalidate());
      this.reconcileVisibleComponents();
      return {
        invalidate: () => this.invalidate(),
        dispose: () => {
          unsubBranch();
          this.disposeComponents();
          this.tui = undefined;
          this.theme = undefined;
          this.footerData = undefined;
        },
        render: (width: number) => this.render(width),
      };
    });
  }

  listen(): void {
    if (this.unsubscribers.length > 0) return;
    this.unsubscribers.push(
      this.pi.events.on(FOOTER_MANAGER_REGISTER_FRAGMENT, (data) => this.register(data)),
      this.pi.events.on(FOOTER_MANAGER_UNREGISTER_FRAGMENT, (data) => this.unregister(data)),
      this.pi.events.on(FOOTER_MANAGER_INVALIDATE, () => this.invalidate())
    );
  }

  shutdown(): void {
    for (const unsub of this.unsubscribers.splice(0)) unsub();
    this.disposeComponents();
    this.entries.clear();
    this.ctx?.ui.setFooter(undefined);
    this.ctx = undefined;
    this.tui = undefined;
    this.theme = undefined;
    this.footerData = undefined;
  }

  private warn(key: string, message: string, type: WarnType = "warning"): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    if (this.ctx?.hasUI) this.ctx.ui.notify(`[footer-manager] ${message}`, type);
    else console.warn(`[footer-manager] ${message}`);
  }

  private loadLayout(): void {
    let source: "project" | "global" | "default" = "default";
    let raw: unknown;
    try {
      const manager = SettingsManager.create((this.ctx as any)?.cwd ?? process.cwd());
      const project = manager.getProjectSettings() as any;
      const global = manager.getGlobalSettings() as any;
      if (Object.prototype.hasOwnProperty.call(project, "footerManager")) {
        source = "project";
        raw = project.footerManager;
      } else if (Object.prototype.hasOwnProperty.call(global, "footerManager")) {
        source = "global";
        raw = global.footerManager;
      }
      for (const error of manager.drainErrors()) this.warn(`settings:${error.scope}`, `could not read ${error.scope} settings: ${error.error.message}`);
    } catch (error) {
      this.warn("settings:create", `could not load settings: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (source === "default") {
      this.layout = DEFAULT_LAYOUT;
      return;
    }

    const parsed = this.validateSettings(raw, source);
    this.layout = parsed ?? DEFAULT_LAYOUT;
  }

  private validateSettings(value: unknown, source: string): ValidLayout | undefined {
    const settings = asObject(value);
    const layout = asObject(settings?.layout);
    if (!settings || !layout) {
      this.warn(`layout:${source}:shape`, `${source} footerManager.layout is missing or invalid; using default layout`);
      return undefined;
    }
    const rowsValue = layout.rows;
    if (!Array.isArray(rowsValue) || rowsValue.length === 0) {
      this.warn(`layout:${source}:rows`, `${source} footerManager.layout.rows must be a non-empty array; using default layout`);
      return undefined;
    }
    const separator = layout.separator === undefined ? DEFAULT_LAYOUT.separator : layout.separator;
    if (typeof separator !== "string") {
      this.warn(`layout:${source}:separator`, `${source} footerManager.layout.separator must be a string; using default layout`);
      return undefined;
    }

    const rows: ValidLayout["rows"] = [];
    for (let rowIndex = 0; rowIndex < rowsValue.length; rowIndex++) {
      const row = asObject(rowsValue[rowIndex]);
      const regionsValue = row?.regions;
      if (!row || !Array.isArray(regionsValue)) {
        this.warn(`layout:${source}:row:${rowIndex}`, `${source} footer row ${rowIndex} is invalid; using default layout`);
        return undefined;
      }
      const regions: Region[] = [];
      for (let regionIndex = 0; regionIndex < regionsValue.length; regionIndex++) {
        const region = asObject(regionsValue[regionIndex]);
        const label = typeof region?.name === "string" ? region.name : `${rowIndex}.${regionIndex}`;
        const width: FooterRegionWidth = region?.width === undefined ? "auto" : region.width as FooterRegionWidth;
        const align = region?.align;
        const fragments = region?.fragments;
        if (width !== "auto" && (typeof width !== "number" || !Number.isFinite(width) || width < 0 || width > 1)) {
          this.warn(`layout:${source}:region:${label}:width`, `${source} footer region ${label} has invalid width; expected a number from 0 to 1, "auto", or omitted; using default layout`);
          return undefined;
        }
        if (align !== "left" && align !== "center" && align !== "right") {
          this.warn(`layout:${source}:region:${label}:align`, `${source} footer region ${label} has invalid align; using default layout`);
          return undefined;
        }
        if (!Array.isArray(fragments) || !fragments.every((id) => typeof id === "string")) {
          this.warn(`layout:${source}:region:${label}:fragments`, `${source} footer region ${label} has invalid fragments; using default layout`);
          return undefined;
        }
        regions.push({ name: typeof region?.name === "string" ? region.name : undefined, width, align, fragments });
      }
      const numericSum = regions.reduce((acc, r) => acc + numericWidth(r.width ?? "auto"), 0);
      const hasAuto = regions.some((r) => isAutoWidth(r.width ?? "auto"));
      if (!hasAuto && numericSum <= 0) {
        this.warn(`layout:${source}:row:${rowIndex}:zero`, `${source} footer row ${rowIndex} widths sum to zero; using default layout`);
        return undefined;
      }
      if (!hasAuto && Math.abs(numericSum - 1) > 0.000001) this.warn(`layout:${source}:row:${rowIndex}:normalize`, `${source} footer row ${rowIndex} widths sum to ${numericSum}; normalizing`);
      rows.push({ regions });
    }
    return { separator, rows };
  }

  private register(data: unknown, persist = true): void {
    const registration = asObject(data) as FooterFragmentRegistration | undefined;
    if (!registration || typeof registration.id !== "string" || !ID_RE.test(registration.id) || typeof registration.component !== "function") {
      this.warn(`register:invalid:${JSON.stringify(data)?.slice(0, 60)}`, "invalid fragment registration ignored");
      return;
    }
    if (persist) this.persistedRegistrations.set(registration.id, registration);
    const existing = this.entries.get(registration.id);
    if (existing) {
      this.warn(`register:duplicate:${registration.id}`, `duplicate fragment '${registration.id}' registered; using latest`);
      this.disposeEntry(registration.id, existing);
    }
    this.entries.set(registration.id, { registration });
    this.pendingUnknownWarnings.delete(registration.id);
    this.reconcileVisibleComponents();
    this.invalidate();
  }

  private unregister(data: unknown): void {
    const id = typeof data === "string" ? data : typeof asObject(data)?.id === "string" ? (asObject(data)!.id as string) : undefined;
    if (!id) return;
    const entry = this.entries.get(id);
    if (!entry) return;
    this.disposeEntry(id, entry);
    this.entries.delete(id);
    this.persistedRegistrations.delete(id);
    this.invalidate();
  }

  private registerBuiltIns(): void {
    for (const fragment of createBuiltInFragments({ getSeparator: () => this.layout.separator })) {
      this.register(fragment, false);
    }
  }

  private visibleIds(): Set<string> {
    const ids = new Set<string>();
    for (const row of this.layout.rows) {
      for (const region of row.regions) {
        const width = region.width ?? "auto";
        if (!isAutoWidth(width) && width <= 0) continue;
        for (const id of region.fragments) ids.add(id);
      }
    }
    return ids;
  }

  private reconcileVisibleComponents(): void {
    if (!this.ctx || !this.tui || !this.theme || !this.footerData) return;
    const visible = this.visibleIds();
    for (const [id, entry] of this.entries) {
      if (!visible.has(id)) {
        if (entry.component) this.disposeEntry(id, entry);
        continue;
      }
      if (entry.component) continue;
      try {
        entry.component = entry.registration.component({ ctx: this.ctx, tui: this.tui, theme: this.theme, footerData: this.footerData, separator: this.layout.separator, invalidate: () => this.invalidate() });
      } catch (error) {
        this.warn(`factory:${id}`, `fragment '${id}' factory failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private disposeEntry(id: string, entry: Entry): void {
    if (!entry.component) return;
    try { entry.component.dispose?.(); } catch (error) { this.warn(`dispose:${id}`, `fragment '${id}' dispose failed: ${error instanceof Error ? error.message : String(error)}`); }
    entry.component = undefined;
  }

  private disposeComponents(): void {
    for (const [id, entry] of this.entries) this.disposeEntry(id, entry);
  }

  private invalidate(): void {
    if (!this.tui || this.renderQueued) return;
    this.renderQueued = true;
    setTimeout(() => {
      this.renderQueued = false;
      this.tui?.requestRender();
    }, 0);
  }

  private renderFragment(id: string, regionWidth: number): string | undefined {
    const entry = this.entries.get(id);
    if (!entry) {
      if (!this.unknownWarned.has(id) && !this.pendingUnknownWarnings.has(id)) {
        this.pendingUnknownWarnings.add(id);
        setTimeout(() => {
          this.pendingUnknownWarnings.delete(id);
          if (this.entries.has(id) || this.unknownWarned.has(id)) return;
          this.unknownWarned.add(id);
          this.warn(`unknown:${id}`, `unknown fragment '${id}' skipped`);
        }, UNKNOWN_FRAGMENT_WARNING_DELAY_MS);
      }
      return undefined;
    }
    if (!entry.component) this.reconcileVisibleComponents();
    if (!entry.component) return undefined;
    try {
      return stripNewlines(entry.component.render() || "");
    } catch (error) {
      this.warn(`render:${id}`, `fragment '${id}' render failed: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  private renderRegionContent(region: Region, width: number): string {
    if (width <= 0 || region.fragments.length === 0) return "";
    const sep = this.theme?.fg("dim", this.layout.separator) ?? this.layout.separator;
    let parts = region.fragments.map((id: string) => this.renderFragment(id, width)).filter((part): part is string => part !== undefined && visibleWidth(part) > 0);
    while (parts.length > 1 && visibleWidth(parts.join(sep)) > width) {
      parts = region.align === "right" ? parts.slice(1) : parts.slice(0, -1);
    }
    return parts.length === 1 ? truncateToWidth(parts[0], width) : parts.join(sep);
  }

  private measureRegion(region: Region, maxWidth: number): number {
    return visibleWidth(this.renderRegionContent(region, maxWidth));
  }

  private renderRegion(region: Region, width: number): string {
    return alignText(this.renderRegionContent(region, width), width, region.align);
  }

  render(width: number): string[] {
    const safeWidth = Math.max(0, Math.floor(width));
    if (safeWidth <= 0) return [];
    this.reconcileVisibleComponents();
    const lines: string[] = [];
    for (const row of this.layout.rows) {
      const gapWidth = Math.max(0, row.regions.length - 1);
      const contentWidth = Math.max(0, safeWidth - gapWidth);
      const widths = allocateWidths(row.regions, contentWidth, (region) => this.measureRegion(region, contentWidth));
      const regions = row.regions.map((region: Region, i: number) => this.renderRegion(region, widths[i] ?? 0));
      const hasContent = regions.some((region: string) => visibleWidth(region.trim()) > 0);
      if (!hasContent) continue;
      lines.push(padToWidth(truncateToWidth(regions.join(" "), safeWidth), safeWidth));
    }
    return lines;
  }
}

export default function (pi: ExtensionAPI) {
  const manager = new FooterManager(pi);
  manager.listen();

  pi.on("session_start", async (_event, ctx) => {
    manager.start(ctx);
  });

  pi.on("session_shutdown", async () => {
    manager.shutdown();
  });

  pi.on("turn_end", async () => {
    pi.events.emit(FOOTER_MANAGER_INVALIDATE, { id: "footer-manager" });
  });

  pi.on("model_select", async () => {
    pi.events.emit(FOOTER_MANAGER_INVALIDATE, { id: "footer-manager" });
  });

  pi.on("thinking_level_select", async () => {
    pi.events.emit(FOOTER_MANAGER_INVALIDATE, { id: "footer-manager" });
  });
}
