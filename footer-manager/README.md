# footer-manager

`footer-manager` is the cooperative owner of Pi footer rendering. It calls `ctx.ui.setFooter(...)`; other extensions should register footer fragments instead of replacing the footer directly. Pi cannot enforce this yet, so disable conflicting extensions that call `ctx.ui.setFooter(...)`.

The local `minimal-footer` extension has been disabled by renaming its entrypoint to `minimal-footer/index.ts.disabled`.

## Register a fragment

```ts
import {
  FOOTER_MANAGER_REGISTER_FRAGMENT,
  type FooterFragmentRegistration,
} from "./footer-manager/types";

export default function (pi) {
  pi.on("session_start", async () => {
    const fragment: FooterFragmentRegistration = {
      id: "my-extension.timer",
      label: "Timer",
      component: (env) => ({
        render() {
          return env.theme.fg("accent", "12m");
        },
        dispose() {},
      }),
    };
    pi.events.emit(FOOTER_MANAGER_REGISTER_FRAGMENT, fragment);
  });
}
```

Fragment factories and `render()` are synchronous. Do async work in the fragment and cache state, then call `env.invalidate()`. Use `env.separator` when a fragment needs to join multiple internal values with the layout separator.

## Invalidate/redraw

```ts
env.invalidate();
// or
pi.events.emit("footer-manager:invalidate", { id: "my-extension.timer" });
```

Invalidations are coalesced and the manager owns `tui.requestRender()`.

## Layout config

Settings live under `footerManager.layout.rows`:

```json
{
  "footerManager": {
    "layout": {
      "separator": " > ",
      "rows": [
        {
          "regions": [
            { "width": 0.65, "align": "left", "fragments": ["cwd.full", "git.branch", "context.gauge"] },
            { "width": 0.35, "align": "right", "fragments": ["model.name", "thinking.level", "statuses"] }
          ]
        }
      ]
    }
  }
}
```

Widths are optional and default to `"auto"`. When provided, widths can be fractions between `0` and `1`, or the string `"auto"`. In rows with auto regions, fractional regions are allocated first using their fraction of the full row width, then the remaining width is assigned to auto regions. Auto regions request their rendered content width; if the requests do not fit, regions are cut from right to left, so the rightmost region loses width first.

For rows without auto regions, per-row widths should sum to `1`; positive non-1 sums are normalized with a warning. A non-auto row whose widths sum to `0`, invalid rows/regions, or invalid settings fall back to the built-in default layout.

Example mixed row: `{ "width": 0.35, "align": "right", "fragments": ["model.name", "statuses"] }` with `{ "align": "left", "fragments": ["git.branch"] }` gives the fixed region 35% of the row and assigns the remaining 65% to the auto/default region.

Project settings win over global settings. If project `footerManager` exists but is invalid, the default layout is used; global `footerManager` is not merged or used as fallback.

## Overflow behavior

Each row is rendered to exactly the terminal width unless all content is empty, in which case the row is omitted. Each region renders inside its allocated width, with one literal space reserved between adjacent regions. Fractional widths are resolved first, then remaining width is allocated to auto regions. When auto regions overflow the remaining width, the rightmost region is cut first. If a region overflows, fragments are dropped based on alignment: left/center-aligned regions drop from the right, while right-aligned regions drop from the left. If one remaining fragment is still too wide, it is ANSI-safely truncated according to alignment.

## Built-in fragments

- `cwd.full`
- `git.branch`
- `model.name`
- `model.cost` (`↑$input ↓$output` per 1M tokens)
- `model.cacheCost` (`Rread Wwrite` per 1M cached tokens)
- `cache.hit` (`cache 72%`)
- `cache.hit_counts` (`cache 95% R5.7M/W0`)
- `thinking.level`
- `context.gauge`
- `cost.total`
- `statuses`

`statuses` preserves compatibility with extensions using `ctx.ui.setStatus(...)` by joining status values in insertion order with the layout separator.

## Example extension

`../fragments/footer-timer-fragment.ts` registers `timer.work` through the event bus and demonstrates cached state plus `env.invalidate()`. Add `"timer.work"` to a layout region to show it.
