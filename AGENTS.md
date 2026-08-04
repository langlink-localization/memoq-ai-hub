# memoQ AI Hub

## Repository purpose
- Windows-focused memoQ plugin plus Electron desktop gateway for AI translation providers, profiles, terminology, history, cache, diagnostics, and packaging.

## Key entrypoints
- `native/plugin/` owns memoQ SDK integration; `apps/desktop/` owns the gateway, worker, UI, and local state.
- `native/preview-helper/`, `packages/contracts/`, `tooling/scripts/`, and `docs/repository-structure.md` define supporting boundaries.

## Canonical commands
- Install with `pnpm install` and `pnpm run install:desktop`.
- Verify with `pnpm run test:desktop`, `pnpm run test:repo`, and `pnpm run build:plugin`.
- Prepare or package releases only through the existing `prepare:release`, `package:desktop`, `zip:desktop`, or `package:windows` scripts.

## Working rules
- Keep memoQ SDK and forwarding logic thin; provider and product behavior belongs in the desktop app.
- Keep shared plugin/desktop shapes in `packages/contracts/`; update both consumers and tests when the wire contract changes.
- Do not commit provider credentials, local history, cache, logs, packaged output, or installed DLL state.
- Do not claim an internal runtime capability is shipped unless it is exposed by the current UI and documented flow.

## Validation
- Run focused desktop tests for UI/runtime changes and repo tests for cross-package contracts.
- For plugin or packaging changes, also build the plugin and run the matching release-preparation command on a supported Windows environment.

