import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  FOOTER_MANAGER_INVALIDATE,
  FOOTER_MANAGER_REGISTER_FRAGMENT,
  FOOTER_MANAGER_UNREGISTER_FRAGMENT,
  type FooterFragmentRegistration,
} from "../footer-manager/types";

const FRAGMENT_ID = "timer.work";

type TimerState =
  | { status: "idle" }
  | { status: "running"; startedAt: number }
  | { status: "done"; elapsedMs: number };

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export default function (pi: ExtensionAPI) {
  let state: TimerState = { status: "idle" };

  function invalidate() {
    pi.events.emit(FOOTER_MANAGER_INVALIDATE, { id: FRAGMENT_ID });
  }

  const registration: FooterFragmentRegistration = {
    id: FRAGMENT_ID,
    label: "Work timer",
    component: (env) => {
      const interval = setInterval(() => {
        if (state.status === "running") env.invalidate();
      }, 1000);

      return {
        render() {
          if (state.status === "idle") return "";

          if (state.status === "running") {
            return env.theme.fg("accent", "⏱") + env.theme.fg("dim", ` ${formatDuration(Date.now() - state.startedAt)}`);
          }

          return env.theme.fg("success", "✓") + env.theme.fg("dim", ` ${formatDuration(state.elapsedMs)}`);
        },
        dispose() {
          clearInterval(interval);
        },
      };
    },
  };

  pi.on("session_start", async () => {
    state = { status: "idle" };
    pi.events.emit(FOOTER_MANAGER_REGISTER_FRAGMENT, registration);
  });

  pi.on("agent_start", async () => {
    state = { status: "running", startedAt: Date.now() };
    invalidate();
  });

  pi.on("agent_end", async () => {
    if (state.status === "running") {
      state = { status: "done", elapsedMs: Date.now() - state.startedAt };
      invalidate();
    }
  });

  pi.on("session_shutdown", async () => {
    state = { status: "idle" };
    pi.events.emit(FOOTER_MANAGER_UNREGISTER_FRAGMENT, { id: FRAGMENT_ID });
  });
}
