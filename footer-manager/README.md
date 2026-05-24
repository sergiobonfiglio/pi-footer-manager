# footer-manager

`footer-manager` is the cooperative owner of Pi footer rendering.

It calls `ctx.ui.setFooter(...)` once, while other extensions contribute footer fragments through a shared registration API instead of competing to replace the whole footer. Pi cannot enforce this yet, so disable conflicting extensions that also call `ctx.ui.setFooter(...)` directly.

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

Fragment factories and `render()` are synchronous. Do async work inside the fragment, cache state locally, then call `env.invalidate()` when the rendered output should refresh. Use `env.separator` when a fragment needs to join multiple internal values with the current layout separator.

## Invalidate / redraw

```ts
env.invalidate();
// or
pi.events.emit("footer-manager:invalidate", { id: "my-extension.timer" });
```

Invalidations are coalesced and the manager owns `tui.requestRender()`.

## Layout configuration

Settings live under `footerManager.layout`.

- `separator` controls how fragments are joined inside a region
- `rows` is an array of footer rows
- each row has `regions`
- each region can set:
  - `width`: a fraction like `0.35` or `"auto"`
  - `align`: `"left"`, `"center"`, or `"right"`
  - `fragments`: fragment ids to render in that region

Example:

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

Project settings override global settings. If project `footerManager` exists but is invalid, the default layout is used; global `footerManager` is not merged as fallback.

## Widths and overflow

Widths are optional and default to `"auto"`.

- fractional regions get their width first
- `"auto"` regions get the remaining width
- if content does not fit, fragments are dropped before the last visible fragment is truncated
- left- and center-aligned regions drop fragments from the right
- right-aligned regions drop fragments from the left

Mixed example:

```json
{
  "regions": [
    { "align": "left", "fragments": ["cwd.full", "git.branch"] },
    { "width": 0.35, "align": "right", "fragments": ["model.name", "statuses"] }
  ]
}
```

This behaves roughly like:

```text
[ cwd.full > git.branch                    ][ model.name > statuses ]
```

For rows without auto regions, widths should sum to `1`. Positive non-`1` sums are normalized with a warning. Invalid rows, invalid regions, or zero-width fully fixed rows fall back to the built-in default layout.

## Built-in fragments

- `cwd.full` — full path of the current working directory
- `git.branch` — current Git branch for the active working tree
- `model.name` — active model name
- `model.cost` — input/output token pricing for the active model
- `model.cacheCost` — cached token read/write pricing for the active model
- `cache.hit` — cache hit rate summary
- `cache.hit_counts` — cache hit rate with read/write token counts
- `thinking.level` — current reasoning/thinking level
- `context.gauge` — graphical context usage indicator
- `cost.total` — total accumulated session cost
- `statuses` — status items contributed through Pi status APIs

`statuses` preserves compatibility with extensions using `ctx.ui.setStatus(...)` by joining status values in insertion order with the layout separator.

## Example extension

`../fragments/footer-timer-fragment.ts` registers `timer.work` through the event bus and demonstrates cached state plus `env.invalidate()`. Add `"timer.work"` to a layout region to show it.
