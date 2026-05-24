# pi-footer-manager

One footer, many extensions: build flexible Pi footers from reusable fragments with configurable layout and built-in fragments instead of competing `setFooter()` calls.

`pi-footer-manager` lets one extension own `ctx.ui.setFooter(...)` while built-in and custom fragments are arranged through a shared API, with flexible rows, regions, widths, alignment, and redraw/invalidation flow.

![pi-footer-manager screenshot](./assets/pi-footer-manager.png)

## Included extensions

- `footer-manager/index.ts` — cooperative footer owner
- `fragments/footer-timer-fragment.ts` — example fragment showing elapsed work time
- `fragments/quota-footer-fragment.ts` — richer quota usage display for supported providers
- `fragments/quota-footer-fragment-text.ts` — text-focused quota usage display
- `fragments/context-gauge-text-fragment.ts` — text version of context usage

## How configuration works

Layout is configured under `footerManager.layout` in Pi settings.

- `separator` controls how fragments are joined inside a region
- `rows` is an array of footer rows
- each row has `regions`
- each region can set:
  - `width`: fraction like `0.35` or `"auto"`
  - `align`: `"left"`, `"center"`, or `"right"`
  - `fragments`: fragment ids to render in that region

Project settings override global settings.

## Example: simple two-region footer

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

## Example: mostly automatic sizing

```json
{
  "footerManager": {
    "layout": {
      "rows": [
        {
          "regions": [
            { "align": "left", "fragments": ["cwd.full", "git.branch"] },
            { "width": 0.35, "align": "right", "fragments": ["model.name", "statuses"] }
          ]
        }
      ]
    }
  }
}
```

In mixed layouts, fixed fractional regions are allocated first and the remaining width goes to `"auto"` regions.

## Example: multi-row footer

```json
{
  "footerManager": {
    "layout": {
      "rows": [
        {
          "regions": [
            { "align": "left", "fragments": ["cwd.full", "git.branch"] },
            { "align": "right", "fragments": ["model.name", "thinking.level"] }
          ]
        },
        {
          "regions": [
            { "align": "left", "fragments": ["context.gauge.text", "quota.current.text", "timer.work"] }
          ]
        }
      ]
    }
  }
}
```

## Widths and overflow

Think of each row as a fixed-width bar split into regions:

```text
[ left region                              ][       right region ]
```

For this layout:

```json
{
  "regions": [
    { "align": "left", "fragments": ["cwd.full", "git.branch"] },
    { "width": 0.35, "align": "right", "fragments": ["model.name", "statuses"] }
  ]
}
```

The row behaves roughly like this:

```text
[ cwd.full > git.branch                    ][ model.name > statuses ]
```

Rules of thumb:

- fixed fractional regions get their width first
- `"auto"` regions get the remaining space
- if content does not fit, fragments are dropped before the final visible fragment is truncated
- left- and center-aligned regions drop fragments from the right
- right-aligned regions drop fragments from the left

Multi-row layouts behave like stacked bars:

```text
row 1: [ cwd.full > git.branch           ][ model.name > statuses ]
row 2: [ context.gauge.text > timer.work                         ]
```

## Built-in fragments

Main built-ins provided by `footer-manager` include:

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

The included fragment extensions add examples like:

- `timer.work` — elapsed time for the current agent run
- `context.gauge.text` — text version of context usage
- `quota.current` — quota usage summary for supported providers
- `quota.current.text` — text-focused quota usage summary

## Custom fragments

Other extensions should register fragments instead of calling `ctx.ui.setFooter(...)` directly.

See detailed fragment API docs and examples in:

- [`footer-manager/README.md`](./footer-manager/README.md)

## Check

```bash
npm run check
```

## Publish dry run

```bash
npm run release:check
```
