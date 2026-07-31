# UI/UX Governance Follow-up Specification

## Goal

Apply the follow-up audit in `docs/ui-ux-governance-plan.md` so the desktop renderer has safe asynchronous feedback, one Ant Design token and component contract, consistent reachable page patterns, complete localization, and a smaller drift surface.

## Context

The July 10 remediation in `docs/specs/ui-ux-remediation/` completed navigation, onboarding, keyboard, dirty-state, and information-hierarchy work. The July 31 audit found remaining interaction-safety, theme, component-contract, localization, duplication, and renderer-structure debt. This specification governs that second pass without rewriting the completed journey work.

## Constraints

- Preserve memoQ integration, provider, profile, asset, history, persisted-data, and local gateway contracts.
- Keep React 18, Ant Design 5, Electron, pnpm, and the existing localization model.
- Keep one primary writer and deliver incremental P0, P1, and P2 slices with passing focused checks.
- Use `ConfigProvider.theme` as the UI theme source of truth; do not introduce another UI library or parallel token system.
- Do not introduce a router, dark mode, Redux/Zustand, or unrelated backend refactors.
- Do not launch browser-based tooling without explicit user approval.
- Preserve user work in the primary worktree and do implementation in the isolated worktree.

## Done When

- Every P0 item in the source plan has implementation and automated evidence or is explicitly retired with current-code evidence.
- P1 token, shell, reachable-page, form, localization, breakpoint, and empty-state contracts are aligned with `docs/ui-governance.md`.
- Confirmed P2 dead code and duplication are removed; Dashboard/History page extraction and page-scoped polling are completed with render-isolation evidence.
- English and Chinese locale keys match.
- `pnpm run test:desktop`, `pnpm run test:repo`, and the renderer production build pass.
- The initiative ledger and verification matrix identify the verified commit/worktree state and next action.

## Repositories In Scope

- `memoq-ai-hub`: source of truth and only write target.

## Source Of Truth

- Audit and staged acceptance: `docs/ui-ux-governance-plan.md`.
- UI behavior contract: `docs/ui-governance.md`.
- Initiative state: `docs/initiatives/ui-ux-governance.yaml`.
- Implementation and verification: this repository, its tests, and GitHub CI when remote work is authorized.

## Non-goals

- Rebranding, dark mode, replacing Ant Design, or adding a CSS-in-JS dependency.
- Changing runtime translation behavior, provider APIs, storage formats, or memoQ SDK behavior.
- Publishing a release, writing GitHub state, or deploying the application.
- Treating unreachable legacy pages as supported product surfaces.

## Verification Gates

- Feedback APIs inherit the configured Ant Design context and no static feedback warning remains.
- Reachable asynchronous actions expose an operation-scoped pending state and reject duplicate submission.
- High-risk destructive actions explain consequences before execution; global and startup errors are recoverable.
- Header, page header, editor actions, grids, forms, and empty states follow the current UI contract.
- Theme and CSS checks find no parallel `--app-*` variables, unscoped `.ant-*` overrides, or `!important` declarations.
- Supported widths are 1024, 1280, 1440, and 1920. Navigation is expanded at 1200 px and above, compact from 769-1199 px, and uses the drawer at 768 px and below, without page-level overflow.
- Reachable custom selections are keyboard-operable with visible focus and selected-state metadata.
- English and Chinese locale key sets are identical and visible fallback copy is localized.
- Focused interaction tests, desktop tests, repository tests, and renderer build pass.

## Rollout Waves

1. P0 interaction safety and recoverable feedback.
2. P1 theme, shell, page-pattern, form, localization, breakpoint, and empty-state convergence.
3. P2 dead-code, duplication, structure, and bounded render-performance debt.
4. Verification, documentation, self-review, and ledger closeout.

## Rollback Condition

Rollback the current wave if it breaks a persisted/runtime contract, removes a reachable workflow, makes a supported desktop width overflow at page level, or fails an agreed verification gate without an in-wave fix.

## GitHub Tracking

- Project: pending; no remote write authorized.
- Issues: pending; current work is Codex goal and isolated-branch scoped.
- Pull request: pending user authorization.
