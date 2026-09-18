# In-App One-Click Updates for v1.0.46

## Goal

Let both installed and portable builds complete the whole update cycle inside the app: check, download, verify, prepare, restart, and (for portable builds) replace the app folder — with no browser download and no manual unzip-and-overwrite.

## Context

- The update center already checks the stable manifest, compares versions, and verifies SHA-256 digests fail-closed (`specs/update-integrity-v1.0.25`).
- The Windows installer was built by the packaging pipeline but never published, and the manifest never carried an `installer` asset, so the installed-mode in-app download path had nothing to fetch.
- Portable builds deliberately opened a browser download page (`update-integrity-v1.0.25` non-goal). This spec supersedes that non-goal for one-click updates.
- Downloads previously buffered the whole artifact in memory with no progress reporting.

## Constraints

- Add no dependency: the updater stays custom on `globalThis.fetch`, Node built-ins, and PowerShell for extraction/apply.
- Keep the wire contract (`packages/contracts`) and the memoQ plugin protocol unchanged.
- Fail closed at every boundary: download-time digest verification, prepare-time re-verification before extraction, apply-time staging validation, and launch-time installer re-verification.
- Portable apply support requires a packaged app layout (`resources/app.asar` beside the executable) and a writable parent directory; otherwise the app falls back to the browser download page and says why.
- The apply helper must survive the app exiting, wait for the process tree to release file locks, retry the directory rename, roll the rename back if the move fails, and relaunch the old executable on failure.
- User data roots (`%APPDATA%/memoq-ai-hub`, `%LOCALAPPDATA%/memoQ AI Hub`, Electron userData) are never touched by an update.
- Downloads stream to a `.part` file with an incremental hash and are renamed into place only after the digest matches; no `.part` or artifact survives a verification failure.

## Done When

- The stable manifest publishes `assets.installer` with a SHA-256 digest computed from the Squirrel `setup.exe`, and the release workflow uploads the installer beside the ZIP, 7z, and manifest.
- Installer downloads stream to disk, report byte progress through the update state, and re-verify the persisted file before `shell.openPath`.
- Portable builds download the verified ZIP in-app, re-verify it before extraction, stage it beside the app (or under user data when the sibling location is not writable), and validate that the staging root contains the packaged executable.
- The dashboard offers download → restart-and-update for portable builds when in-app apply is supported, blocks the restart while AI requests are active, and keeps the browser download page as a fallback.
- A persisted `restarting` state from an interrupted session renormalizes to `prepared` (same app version) or resets (new app version).
- Startup removes stale apply backups while preserving staged updates that may still be applied.
- Focused desktop tests, repository tests, typecheck, renderer build, and the Windows packaging script pass; the release workflow uploads every manifest-advertised asset.

## Repositories in Scope

- `langlink-localization/memoq-ai-hub` only.

## Source of Truth

- Release version: `apps/desktop/package.json`.
- Manifest contract and generation: `tooling/scripts/release-metadata.mjs`.
- Runtime enforcement: `apps/desktop/src/update/updateService.js`, `apps/desktop/src/update/portableUpdateApplier.js`, and the main/background worker IPC path.
- Engineering state: remote `main`, GitHub Actions, tag `v1.0.46`, and its GitHub Release.

## Non-Goals

- Fully silent background updates (Squirrel `Update.exe` feed, `RELEASES`/nupkg publication, or an electron-updater/electron-builder migration).
- Code signing or a signing service; SmartScreen friction on the unsigned installer is documented, not removed.
- Proxy or mirror configuration for the GitHub-hosted feed.
- Auto-updating the memoQ plugin DLL; the existing dashboard Install/Reinstall flow and `pluginReinstallRecommended` notice stay as they are.

## Verification Gates

1. `tests/repo/releaseMetadata.test.mjs` covers the installer asset, nested digest computation, and workflow upload assertions.
2. `apps/desktop/test/updateService.test.js` covers the portable download → prepare → restarting state machine, prepare-time tamper rejection, streaming progress, and persisted-state renormalization.
3. `apps/desktop/test/portableUpdateApplier.test.js` covers script generation (wait, retry, rollback, relaunch, quote escaping), detached spawn options, staging validation, and startup cleanup.
4. `apps/desktop/test/mainIpcRegistrar.test.js` covers the apply channel's worker-state validation, helper scheduling, restarting mark, and quit ordering.
5. `pnpm run typecheck`, `pnpm run test:desktop`, `pnpm run test:repo`, and `tooling/scripts/package-windows.ps1` pass on Windows.

## Rollout Waves

1. Implement and verify in an isolated worktree.
2. Merge to local `main`, push, and wait for main CI.
3. Create and push `v1.0.46` from the exact green main commit.
4. Verify the release assets (ZIP, 7z, setup.exe, manifest), the manifest digests against the uploaded assets, and the `latest/download` manifest URL.

## Rollback Condition

- Before tagging: stop on any failed verification gate or manifest compatibility regression.
- After tagging: do not rewrite `v1.0.46`; if the portable apply path misbehaves in the field, disable the in-app portable apply surface in a patch release and keep the browser-download fallback.

## GitHub Links

- No issue or project link was supplied; this is a user-authorized direct release task continuing the update-center track (`specs/update-integrity-v1.0.25`).
