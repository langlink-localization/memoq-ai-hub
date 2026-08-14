# Delivery record

## Delivered

- Optional MT confidence, deterministic info, confidence signals, and plugin mapping behind a negotiated capability.
- Revisioned atomic Preview cache snapshots; local deterministic and opt-in AI QA; strict schema with one repair; stale-result protection; cancellation, backoff, circuit breaking, cache, and 30-day local persistence.
- Loopback QA API, validated IPC surface, Ant Design quality workbench, read-only MQXLIFF/XLIFF batch reports, and an always-on-top compact window with pause and restored bounded display position.
- English/Chinese UI parity, anonymous calibration/Preview fixtures, and a fail-closed official Ant Design CLI workflow.

## Verified locally on 2026-08-15

- Desktop: 442 passed, 5 existing skipped, 0 failed.
- Repository: 25 passed, 0 failed.
- Plugin regression: passed.
- Plugin Release build: succeeded with memoQ MT SDK 2.4.4; 0 warnings, 0 errors.
- Preview helper Release build and Electron package smoke: succeeded.
- Ant Design CLI 6.5.4: full scan, 0 findings, 0 skipped files, `partial=false`.
- Deterministic QA microbenchmark (1,000 synthetic runs): P95 0.013 ms, below the 100 ms target on this machine.

AI network latency targets require a representative configured provider and were not claimed from synthetic tests. Visual keyboard, screen-reader, multi-display/DPI, sleep/resume, and memoQ 12 host behavior remain manual acceptance work.

## Release and rollback watchpoints

- Do not publish SDK/API-derived binaries until written memoQ distribution permission is recorded.
- A memoQ 12 translator must verify Preview mapping and host display of Confidence/Info before release.
- If live mapping becomes uncertain, keep deterministic and batch checks available and leave AI paused.
- Rollback is bounded by optional capabilities and routes: older plugin/desktop combinations ignore the new fields, and the Quality Checks navigation/IPC/API can be removed without changing existing MT/StoreTranslation semantics.
