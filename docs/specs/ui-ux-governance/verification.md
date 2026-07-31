# UI/UX Governance Verification

Verified on 2026-08-01 in the isolated worktree for branch `codex/ui-ux-governance`, based on `6e70925e239e513b96eb493315c89aad7d3aaea3`.

## Acceptance Matrix

| Area | Evidence | Result |
|---|---|---|
| Themed feedback | Renderer root mounts `AntdApp`; `App.jsx` uses `AntdApp.useApp()` for message and modal feedback. | Pass |
| Pending operations | A shared pending-operation registry rejects duplicate refresh, profile, asset, history export, and history delete mutations; controls expose loading/disabled states. | Pass |
| Destructive actions | Integration install, log cleanup, installer restart, editor discard, and delete flows use danger confirmations with localized consequences. | Pass |
| Recoverable failures | Startup uses separate Spin and Result states; global errors are dismissible and cleared on page navigation; renderer failures use a localized Result with retry. | Pass |
| Theme contract | `ConfigProvider.theme` contains seed/component tokens; renderer CSS contains zero `--app-*`, `.ant-*`, or `!important` declarations. All 15 referenced `--memoq-*` variables resolve to Ant Design design tokens. | Pass |
| Shell and page structure | Global header retains product/language/refresh/connection controls; page title and purpose are rendered in Content; sider collapsed width is 80 px. | Pass |
| Editor actions | Reachable provider/profile editors keep Save as the primary Card action and place destructive secondary actions in a More menu. | Pass |
| Forms | Provider configuration uses Form/Form.Item; Builder numeric fields use bounded InputNumber; History dates use DatePicker. | Pass |
| Localization | English and Chinese locale key sets match; dashboard silent fallbacks are removed; renderer fallback UI, style presets, diagnostics, and new-profile defaults use locale keys. | Pass |
| Responsive contract | Shared JS constants define expanded >=1200 and drawer <=768 behavior; source tests assert CSS media queries at 1199 and 768; data tables retain scoped horizontal scrolling. Electron smoke evidence covers all six pages at 768, 1024, 1280, and 1440 px plus a representative 1920 px wide-screen pass. | Pass |
| Empty states | History, Providers, Assets, and Logs expose an explicit refresh, reset, or creation action where the user can recover. | Pass |
| Accessibility | Reachable provider/profile selection rows retain listbox roles, selected metadata, Enter/Space activation, and visible focus styles. | Pass |
| Dead code and drift | Unreachable Advanced/Prompts pages, unused editors/drawers/helpers/imports, duplicated history confirmation markup, and 36 inline Space flex hacks are removed. Table columns use shared semantic width tokens rather than anonymous pixel values. | Pass |
| Page ownership | Dashboard and the complete History surface, including its diagnostic detail drawer and presentation helpers, are dedicated lazy page modules. Shared hover text no longer lives in the shell. | Pass |
| Polling and bundles | Dashboard polling writes to a page-scoped `useSyncExternalStore` store. Stable or History-only payload changes preserve snapshot identity and emit no render signal; only Dashboard and the header connection tag subscribe. Renderer entry chunk is about 152 KB, with Dashboard at about 8.5 KB and the complete History page at about 16.8 KB. | Pass |

## Automated Gates

- `pnpm run test:desktop`: 430 tests, 425 passed, 5 pre-existing skips, 0 failed.
- `pnpm run test:repo`: 19 passed, 0 failed.
- Renderer production build: passed with Vite 7.3.1; entry 151.56 kB (46.83 kB gzip), Dashboard 8.52 kB, and History 16.79 kB.
- `git diff --check`: passed.
- Focused CSS contract checks: zero parallel variables, Ant Design internal selectors, `!important`, and unresolved Ant Design CSS variables.
- Actual Electron startup and connected-runtime smoke: passed after adding regression coverage for Vite main-process inputs, desktop contract lookup, SQL WASM lookup, and responsive window sizing.
- Viewport evidence: [visual-smoke.md](visual-smoke.md).

## Intentional Boundaries

- The source audit describes drawer navigation below 1024 px, while the existing repository UI contract defines expanded navigation at 1200 px, compact navigation at 769-1199 px, and drawer navigation at 768 px and below. The implementation follows the repository contract and adds exact-boundary tests.
- The audit's AdvancedTuning accessibility item is retired because AdvancedTuning and Prompts had no runtime route or import; both surfaces were deleted instead of preserved.
- The 1920 px gate uses one representative Translation Records pass, as explicitly accepted by the user after complete six-page coverage at 768, 1024, 1280, and 1440 px. This preserves meaningful wide-screen evidence without repeating an already stable layout on every route.

## Completion

All source-plan governance items and verification gates are complete. No UI/UX governance follow-up remains; commit, pull request, and CI actions require separate user authorization.
