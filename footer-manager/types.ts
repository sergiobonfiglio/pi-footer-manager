import type {
  ExtensionContext,
  ReadonlyFooterDataProvider,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

export const FOOTER_MANAGER_REGISTER_FRAGMENT = "footer-manager:register-fragment";
export const FOOTER_MANAGER_UNREGISTER_FRAGMENT = "footer-manager:unregister-fragment";
export const FOOTER_MANAGER_INVALIDATE = "footer-manager:invalidate";

export type FooterFragmentRegistration = {
  id: string;
  label?: string;
  component: (env: FooterRenderEnv) => FooterFragmentComponent;
};

export type FooterRenderEnv = {
  ctx: ExtensionContext;
  tui: TUI;
  theme: Theme;
  footerData: ReadonlyFooterDataProvider;
  separator: string;
  invalidate: () => void;
};

export type FooterFragmentComponent = {
  render(): string;
  dispose?(): void;
};

export type FooterRegionAlign = "left" | "center" | "right";
export type FooterRegionWidth = number | "auto";

export type FooterRegionConfig = {
  name?: string;
  width?: FooterRegionWidth;
  align: FooterRegionAlign;
  fragments: string[];
};

export type FooterRowConfig = {
  regions: FooterRegionConfig[];
};

export type FooterLayoutConfig = {
  separator?: string;
  rows: FooterRowConfig[];
};

export type FooterManagerSettings = {
  layout?: FooterLayoutConfig;
};
