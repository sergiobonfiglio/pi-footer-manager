# pi-footer-manager

One footer, many extensions: build flexible Pi footers from reusable fragments with configurable layout and built-in fragments instead of competing `setFooter()` calls.

`pi-footer-manager` lets one extension own `ctx.ui.setFooter(...)` while built-in and custom fragments are arranged through a shared API, with flexible rows, regions, widths, alignment, and redraw/invalidation flow.

## Included extensions

- `footer-manager/index.ts` — cooperative footer owner
- `fragments/footer-timer-fragment.ts`
- `fragments/quota-footer-fragment.ts`
- `fragments/quota-footer-fragment-text.ts`
- `fragments/context-gauge-text-fragment.ts`

## Check

```bash
npm run check
```

## Publish dry run

```bash
npm run release:check
```
