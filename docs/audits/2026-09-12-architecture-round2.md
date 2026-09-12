# Second architecture pass

Date: 2026-09-12, Asia/Shanghai. Base: `101f12b`. This refines the unshipped **1.0.45** candidate; the version, wire contracts, and database schema are unchanged.

## Review outcome

No blocking findings remain after implementation, primary review, and an independent read-only review. The scope is request ownership across process boundaries, shared provider-health publication, and concurrent credential reads. The independent reviewer checked the changed ownership boundaries and ran 23 supervisor/provider tests plus the three new runtime scenarios successfully.

| Confirmed problem | Resolution and evidence |
| --- | --- |
| A delayed main-process reply used the current global worker, potentially delivering an earlier worker's reply to its replacement. | Capture requester and generation; check ownership before dispatch and reply. Both delayed success and delayed failure are tested across restart. |
| An exited or retiring worker could publish readiness during backoff; shutdown could still accept new invocations. | Close message acceptance on retirement/shutdown, reject pending requests immediately, reject new invocations, and ignore stale messages. Six added supervisor tests cover these boundaries and delayed process exit. |
| Concurrent uncached requests independently decrypted the same credential through IPC. | Coalesce only in-flight reads for the same key and mutation generation. A 24-reader test observes one IPC request; failures release the slot, and older completion cannot remove a replacement read. |
| An old translation could overwrite provider status after settings or credentials changed, or after a newer connection check. | `runtimeProviderStatus` is shared by provider and translation services. Publication requires the same operation token and configuration fingerprint. Mutations invalidate tokens; translation releases ownership in `finally`. Runtime tests cover settings edits, key rotation, and newer checks while preserving returned translations and history. |
| A cache-only translation marked a failed provider connected without contacting it. | Cache-only routes acquire no provider-operation token and cannot publish health. The runtime regression confirms no additional provider call and preserves failed status. |

The fallback-success path was also tested. It already clears earlier errors when all segments are translated; no production change was necessary. Its test preserves successful history, fallback-provider health, and failed-attempt diagnostics.

## Architecture contract

- Process supervision owns worker acceptance, generation identity, and pending-request rejection. An already-dispatched main-process operation is not cancelled or rolled back; its obsolete response is dropped.
- Provider health is a conditional projection owned jointly by connection checks and translations. The tracker does not queue provider execution, change routing, or replace persisted configuration.
- Credential coalescing is scoped to the worker secret bridge. It does not persist decrypted data or share an in-flight result across a credential mutation. Empty responses remain retryable.
- New runtime modules must be registered in the existing Vite entry list. The packaging gate caught the missing `runtimeProviderStatus` entry; registration was added without weakening the check. The packaged-runtime test now loads the actual runtime composition root from extracted ASAR.

## Verification

The candidate uses Node 22.22.2, pnpm 10.6.2, .NET SDK 10.0.401, and memoQ SDK 2.4.4 on Windows x64. Dependency versions are unchanged.

| Check | Result |
| --- | --- |
| Focused runtime, provider concurrency, worker supervisor, and credential bridge tests | 140 passed. |
| New regression evidence before fixes | Five worker tests and three credential tests failed on the old implementation. Two runtime tests reproduced stale health and cache-only connectivity. All pass after the fixes. |
| `pnpm run lint` | Passed, zero warnings, including final packaging-test changes. |
| `pnpm run typecheck` | Passed with typed tracker tokens and existing checked runtime boundaries. |
| `pnpm run test:repo` | 28 passed. |
| `forgePackaging.test.js` | 10 passed after registering the new Vite entry. |
| Canonical packaging test phase | 654 passed, zero failed; four artifact-dependent checks run in the artifact phase below. |
| Final artifact phase | Four passed, zero skipped, rerun from `apps/desktop` after correcting the Node test resource environment; includes loading the runtime composition root from ASAR. |
| `pnpm run package:windows` | Final installer, portable app, ZIP, 7z, and local update manifest regenerated for this candidate. |
| Gateway smoke | Isolated real SQLite runtime; health/version 1.0.45, Host rejection, and lightweight app-state read passed. |
| `git diff --check` | Passed. |

The first packaging attempt stopped at the missing Vite entry. After registration was corrected, the canonical pipeline regenerated all artifacts. Its final ASAR-load gate then exposed a Node-test environment mismatch: extracted runtime modules need the actual packaged Electron `resourcesPath`. The test now sets and restores that path; the exact final artifact gate passed when rerun from the packaging working directory. Production sources and the generated artifacts were unchanged by this test-only correction. The overall pipeline last exited at that gate; success here refers to completed artifact generation plus the repaired final gate, not a later full pipeline invocation. No test was disabled. The 658 desktop checks are covered by the 654-test phase and four artifact checks, not claimed as a single no-skip invocation.

The first-pass Ant Design scan and UI checks remain applicable because this round does not change renderer code, theme, or UI dependencies. This round's production changes were rebuilt into the final package. Native plugin source and wire contracts remain unchanged; the canonical package pipeline rebuilt and prepared the native release inputs.

## Delivery and limits

Deliver as a second local commit on `codex/architecture-uiux-20260912`. No push, tag, PR, publication, installation, or main-branch update is performed. Package outputs and validation logs remain ignored and are not committed.

Standards review covered lifecycle cleanup, stale state, error paths, typed boundaries, test effectiveness, and package registration. Spec review confirmed a bounded second architecture pass with reviewed local commit delivery before 15:00. Remote CI, hosted review, mergeability, deployment, live memoQ/provider sessions, and browser visual acceptance are not represented as verified.

The first-pass commit `101f12b` is the rollback reference for this second pass. No schema rollback is needed. See the [first-pass audit](2026-09-12-architecture-uiux.md) and [1.0.45 release notes](../release-notes/v1.0.45.md).
