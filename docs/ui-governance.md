# Desktop UI Governance

This document is the repository-local UI contract for the memoQ AI Hub desktop renderer. It applies to new surfaces and to the UI/UX remediation initiative.

## Product Journey

The primary setup journey is:

1. Install or repair the memoQ integration.
2. Connect and test an AI service.
3. Upload optional terminology or translation-memory assets.
4. Create and save a translation profile.
5. Run a translation in memoQ and review the resulting record.

Navigation, onboarding, documentation, and empty-state actions must use this order. Logs, updates, and integration maintenance are support tasks after onboarding.

## Application Shell

- Every page exposes a visible page title, a short purpose statement, and at most one primary page action.
- Global connection health remains visible in the shell. Page-specific actions do not live in the global header.
- The last valid page, navigation preference, and per-page scroll position may be restored locally. Invalid or retired page keys fall back to the overview.
- Leaving a dirty provider or profile requires an explicit save, discard, or stay decision.
- At wide widths the shell uses a persistent navigation sider. At narrow widths it uses a temporary drawer; it must not reserve a fixed icon rail beside the content.

## Responsive Layout

- `>= 1200px`: persistent application navigation and two-column master/detail pages are allowed.
- `769px - 1199px`: compact application navigation is allowed, but module selectors must avoid consuming a permanent content column.
- `<= 768px`: navigation is a drawer and module selectors stack or become compact controls.
- Page-level horizontal scrolling is not allowed. Data tables may provide their own horizontal scroll region.
- Data-table columns use the shared semantic width tokens in `tableLayout.mjs`; page components do not embed anonymous pixel widths.
- Primary actions remain reachable without covering content, and overlays stay inside the viewport.

## Interaction And Accessibility

- Clickable list rows use native buttons/links where practical, or equivalent keyboard semantics with `tabIndex`, Enter/Space handling, a visible focus ring, and selected-state metadata.
- Icon-only controls require accessible names and tooltips where the meaning is not otherwise visible.
- Selection, status, and validation cannot rely on color alone.
- Destructive operations require confirmation and must not be the most prominent default action.
- Focus returns to a sensible trigger after drawers and dialogs close.

## Information Density

- Use progressive disclosure for advanced, diagnostic, or low-frequency settings.
- A page should not wrap every section in a nested Card. Cards indicate a meaningful group or state, while headings and spacing establish normal hierarchy.
- Common filters stay visible. Advanced filters live behind an explicit control and active filters remain visible and removable.
- Diagnostic details use tabs or collapsible sections so the summary remains scannable.

## State And Feedback

- Dirty state is visible near the edited resource and in the persistent save area.
- Validation appears near the affected section and prevents invalid saves with an actionable explanation.
- Empty states explain the next useful action.
- Loading, success, failure, disconnected, and stale states use consistent language in English and Chinese.
- Asynchronous mutations expose an operation-scoped pending state and reject duplicate submission until completion.
- Background polling publishes only page-owned state slices; unchanged or unrelated slices must preserve snapshot identity and must not rerender the application shell.
- Message, modal, and notification feedback uses the themed Ant Design application context; global and startup failures remain dismissible or retryable.

## Visual System

- Use Ant Design 5 components and repository theme tokens before adding custom controls.
- `ConfigProvider.theme` is the visual token source of truth. Renderer CSS must not add a parallel color-token system, unscoped Ant Design internals, or `!important` overrides.
- Configuration fields use `Form` and `Form.Item`; numeric and date values use `InputNumber` and `DatePicker` when those semantics apply.
- The spacing rhythm uses 8px increments where practical; page content defaults to 24px wide-screen padding and 16px compact padding.
- Success and warning text must use accessible dark foregrounds; bright semantic colors are reserved for fills, borders, icons, or large text.
- Page titles, section titles, supporting text, and technical metadata have clearly different typographic levels.

## Verification Gates

- English and Chinese locale key sets remain identical.
- Keyboard tests cover application navigation, module lists, row activation, and dirty-navigation protection.
- Responsive checks cover representative 1024px, 1280px, 1440px, and 1920px layouts plus the 768px drawer boundary, with no page-level horizontal overflow.
- Renderer behavior is tested through component interaction where feasible; source-string assertions alone are not sufficient for new behavior.
- `pnpm run test:desktop`, `pnpm run test:repo`, and a renderer compile/package-relevant check must pass before completion.
