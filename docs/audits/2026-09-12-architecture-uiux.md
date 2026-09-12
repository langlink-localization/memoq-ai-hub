# Architecture and UI/UX release-candidate audit

This records the first-pass candidate committed as `101f12b`. See the [second architecture pass](2026-09-12-architecture-round2.md) for subsequent changes and final package evidence.

Date: 2026-09-12, Asia/Shanghai. Candidate: **1.0.45**, based on `82eed89` (1.0.44).

## Review outcome

No blocking findings remain in the reviewed local change. This is a local code review against the repository's Standards and the requested Spec, followed by regression and packaging validation. It is not an external approval or a claim that every existing product behavior is defect-free.

The review found and resolved stale provider writes, indefinitely cached empty credential reads, stale renderer responses, overlapping polls, unprotected project-rule drafts, duplicate provider submissions, editable fields during saves, and interruptible save-and-leave navigation. The new regression tests exercise those failure conditions and the page-recovery boundary. A further delayed-credential-read case now prevents cache resurrection after deletion.

The delivery contract is a reviewed, release-prepared **local commit** before 15:00. No push, tag, PR, installed-plugin change, or publication is part of this delivery.

## Architecture coverage and decisions

| Boundary | Evidence and final decision |
| --- | --- |
| memoQ SDK plugin | Keep `native/plugin/` focused on SDK integration and gateway forwarding. Existing retry/fallback regression scenarios and Release build pass; no protocol change. |
| Preview helper | Preserve `native/preview-helper/` as the bridge owner. The existing release-preparation pipeline builds and includes it. |
| Electron main, preload, worker | Preserve process and credential ownership. Repair the worker-facing secret bridge's transient-read recovery and late-read invalidation without exposing keys to renderer state. |
| Gateway | Initialize its logger per server from runtime paths. Importing the server no longer initializes user-data directories. Keep the existing request validation and Host/Origin guard. |
| Runtime services | Preserve the existing provider/profile/asset/QA/translation service split. Provider writes re-read configuration after asynchronous secret operations; connection tests publish only for their current provider revision and request owner. Independent translation/QA concurrency remains available. |
| Persistence | Add a small history count/latest-outcome projection for dashboard state. It is independent of explorer filters and does not deserialize history payloads. Existing schema and stored data formats remain compatible. |
| Renderer controllers | Share request-generation ownership for replaceable reads and invalidate on unmount. Separate app-state ownership from dashboard-only publication. Share single-flight visible-window polling. |
| UI shell and editors | Contain page errors below the shell, preserve draft/save boundaries, and use existing Ant Design components and theme tokens. Honor reduced motion and keyboard access. |
| Contracts and packaging | Keep `packages/contracts/` unchanged. Use the repository's Windows preparation, packaging, archive, and manifest scripts. Root and desktop versions agree at 1.0.45. |

The repository already has meaningful service and process boundaries. The changes repair ownership across those boundaries; they do not introduce another global state store or a global queue for unrelated runtime operations.

## UI/UX coverage

All eight navigation destinations were inspected in source, together with the shared shell and Assistant. The table distinguishes direct changes from existing behavior covered through shared infrastructure.

| Surface | Result |
| --- | --- |
| Dashboard | Lightweight refresh retains global history progress and latest outcome; obsolete requests cannot publish over newer status. |
| AI services | Duplicate save/test/discovery requests are rejected. Inputs and enabled state are locked while saving. Existing provider/model editing patterns are retained. |
| Assets | Preview switch/close invalidates obsolete results and errors. Errors offer local retry. Structure writes reject duplicate submission and lock dismissal while pending. |
| Profile builder | Fields and conflicting navigation are locked during save. Existing profile validation and dirty-navigation flow are retained. |
| Project rules | Dirty drafts require explicit discard/stay before dismissal or navigation. Save/cancel stay in the drawer footer; pending writes block dismissal. |
| Quality checks | Polling shares the non-overlap/hidden-window policy; loading skeleton honors reduced motion. Existing rule controls remain intact. |
| History | Global refresh retains active explorer filters. Dashboard progress is computed independently of these filters. |
| Diagnostics | Existing diagnostics interactions remain; a page render failure is contained below the navigation shell. |
| Shell and Assistant | Skip-to-content link, named language control, motion preference updates, page retry, and non-overlapping Assistant polling. Existing compact layout and table/drawer sizing are retained. |

No browser or native-window visual inspection was performed: the repository requires prior permission for browser tooling, and that permission was not received. Component tests and compilation support interaction correctness, but do not establish actual pixel layout, focus behavior in Chromium, or overflow at every viewport. The documented 768/1024/1280/1440/1920px visual matrix remains unverified in this run.

## Verification evidence

Validation ran on Windows x64 with Node 22.22.2, the repository's pnpm 10.6.2 contract, Ant Design CLI 6.5.4 matching CI, .NET SDK 10.0.401, and memoQ SDK 2.4.4.

| Check | Result |
| --- | --- |
| `pnpm run lint` | Passed, zero warnings. |
| `pnpm run typecheck` | Passed with the existing JSDoc/checkJs configuration. |
| `pnpm run test:repo` | 28 passed. |
| `pnpm run test:antd` | Official full scan passed: zero findings and zero skipped rules. |
| `pnpm run test:desktop` with `MEMOQ_AI_PACKAGED_APP_DIR` pointing at the final candidate | **646 passed, zero failed, zero skipped.** |
| `pnpm run build:plugin` | Release build passed, zero warnings/errors. |
| `pnpm run test:plugin` | Existing plugin retry/fallback regression scenarios passed. |
| `pnpm run prepare:release` | Passed; plugin and preview-helper release inputs prepared. |
| `pnpm run package:windows` | Passed for 1.0.45; desktop build, installer, ZIP, 7z, and local update manifest generated. All four packaged-artifact checks passed. |
| Local gateway smoke | Real SQLite runtime with isolated temporary data: HTTP health and version return 1.0.45; invalid Host is rejected with 403; lightweight app-state projection succeeds. No provider calls or real credentials. |
| `pnpm run benchmark:desktop --samples 7` | Passed with final package artifacts. Seven fresh runtime processes, explicit non-persistent secret adapter, no external provider calls. Median runtime startup 131.24ms; median initialization RSS 71.91MiB. This measures the worker runtime, not Electron time-to-interactive, and is not a before/after speedup claim. |
| `git diff --check` | Passed. |

The ordinary packaging test phase reports four artifact tests as skipped before their artifacts are available; the subsequent artifact phase passes all four. The final combined desktop run above includes all 646 with no skips. No failing check was disabled or bypassed.

The only added dependency is the development-only `react-test-renderer` pinned to 18.3.1, matching the existing React version, for executable controller and error-boundary tests. The error-boundary test mounts the actual boundary lifecycle with a headless presentation adapter and separately renders the actual Ant Design fallback to HTML; it does not claim browser rendering coverage.

## Standards and Spec assessment

- **Standards:** service ownership, concurrent state preservation, component cleanup, error recovery, English/Chinese key parity, Ant Design governance, typed shared surfaces, existing SDK contracts, and generated-file exclusions were reviewed. Changes remain in one isolated worktree; runtime data, secrets, build outputs, and logs are excluded from the commit.
- **Spec:** architecture was mapped across the native plugin, Electron processes, gateway, services, persistence, renderer, and packaging. The eight UI destinations and shared interactions were covered as described above. The result is a locally packaged and reviewed commit, with release notes and no PR or publication.
- **Remote evidence:** CI, hosted review threads, mergeability, and deployment were not exercised because no remote change was requested. Local checks are reported separately and are not presented as CI results.
- **Runtime limits:** no live memoQ translation session, installed DLL replacement, online provider authentication, or browser visual acceptance was performed. The generated installer was inspected by package tests, not installed into the user's environment.

## Release preparation and rollback

The ignored `apps/desktop/out/` directory contains the 1.0.45 Windows installer, portable app, ZIP, 7z, and update manifest generated by the canonical script. These are local validation artifacts and are not committed or published.

Before an eventual release, perform the normal live memoQ/provider and visual acceptance in the intended environment. If a regression is found, the preceding 1.0.44 commit is the rollback reference; this change introduces no schema migration or wire-contract change requiring a reverse migration. Preserve user data when switching versions.

See [release notes](../release-notes/v1.0.45.md), [repository structure](../repository-structure.md), and [UI governance](../ui-governance.md) for maintained product documentation.
