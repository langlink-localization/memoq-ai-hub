# Translation evidence and terminology reliability

## Goal
Users can independently find a translation, understand the actual profile/model/assets used, check terminology compliance, test asset matching, and compare a fresh translation without losing the original.

## Context and source of truth
The approved P0–P5 plan in this task controls scope. Repository code, tests, GitHub CI and published artifacts establish implementation/delivery facts. Wayne's screenshot motivated a reproducible CJK-number boundary defect; his actual request/configuration is unavailable and must not be invented.

## Scope and constraints
Only memoq-ai-hub changes. Ticket Helper matching is a read-only reference. Preserve records and settings; distinguish binding, matching, sending, and compliance. Old missing evidence is unknown, never inferred. No credentials or full assets in evidence. Use current Ant Design/antd-kit and docs/ui-governance.md. Explicit source/target directions and exact/whole-word semantics remain. Re-translation uses current settings and bypasses caches; results are linked records and do not automatically overwrite memoQ. Model repair is opt-in, at most once, structurally validated, and separately recorded. Actual SDK capabilities determine plugin entry integration.

## Delivery stages
- P0: edge-aware phrase matching; respect disabled glossary; validate cache hits and prevent noncompliant cache writes; optional strict terminology enforcement.
- P1: versioned per-segment evidence for profile/model/assets, matched entries, actual execution/cache provenance and QA; immutable snapshots and unknown legacy states.
- P2: searchable source/target history, result-first detail, per-asset evidence, visible actionable status, advanced diagnostics collapsed.
- P3: local asset test through production matcher; explicit fresh retranslation with old/new comparison and no implicit replacement.
- P4: supported plugin-to-Hub record navigation, exact request identity, safe missing/stale/offline handling; no speculative editor writeback.
- P5: focused/full tests, responsive rendered evidence, Windows packaging, review/CI/merge and release. Record unavailable live memoQ acceptance separately.

## Acceptance
CJK-number cases match; Latin/mixed numbered identifiers do not spuriously match. Disabled/unbound/no-hit/error/sent/compliant states are distinct. Cache never bypasses applicable term validation. Snapshots survive asset mutation. Batch/fallback/retry evidence follows each final result. No-match is not QA success. Self-service test requires no provider call. Repeat operation prevents duplicate calls and preserves the original. Keyboard and narrow/desktop layouts remain usable.

## Verification and rollout
Run lint/typecheck, focused desktop tests, repo tests, AntD gate, production builds and Windows plugin/package CI. Inspect rendered synthetic-data UI at desktop and <=768px. Review before merge; publish a new version with English release notes, verify manifest and artifact digests. Existing release rollback remains available; preserve new additive history fields and original records. Stop rollout on data loss, wrong provenance, broken plugin navigation, or packaging failures.

## Non-goals
Automatically importing memoQ TB without a supported integration; blind text replacement; claiming full translation quality from terminology checks; cross-repo changes; automatic editor overwrite.

## Tracking
GitHub PR: https://github.com/langlink-localization/memoq-ai-hub/pull/16
