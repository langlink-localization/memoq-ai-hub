# Verification evidence

Candidate: `codex/translation-evidence`, release target v1.0.53. This document describes local evidence; GitHub CI, merge and publication are recorded separately.

## Local checks

- `pnpm run lint` and `pnpm run typecheck`: passed.
- `pnpm run test:desktop`: 720 tests, 716 passed, 4 environment skips, 0 failures.
- `pnpm run test:repo`: 28 passed.
- `pnpm run test:antd`: 0 findings, no skipped files.
- Vite production renderer build: passed (existing large vendor-chunk advisory remains).

## Behavior

- Edge-aware CJK/number and Latin/identifier boundaries, reverse language direction, disabled glossary/metadata, and disabled asset file reads have dedicated regressions.
- Runtime integration covers advisory violations, no caching of bad results, opt-in strict rejection, one repair, compliant cache reuse, cache-bypassing retranslation, and local asset testing without provider calls.
- Aggregation tests verify actual saved history lookup, caller/history index separation, confidence/info preservation, partial policy rejection and all-rejected rescue completion instead of a hard timeout.
- Navigation parser and exact lookup reject invalid locators, partial matches and duplicate records. Worker readiness and pending-write guards precede navigation acknowledgement; existing dirty-editor confirmation remains in force.
- Plugin regression scenarios cover direct batch/retry locators, aggregate locators, and no formatting retry after a policy rejection. These require a licensed Windows memoQ runtime and have not run on the development Mac or hosted CI.

## Rendered acceptance

Used the actual TranslationResults, TranslationEvidence and AssetTestPanel components with synthetic data in a temporary local Vite harness, through the Codex in-app browser. The harness was removed after inspection.

- 1440px desktop: source/target and old/new comparison displayed side by side.
- 768px: source/target and comparison stacked; measured document scroll width 753px for a 768px viewport (no horizontal page overflow).
- Local asset testing: language names displayed; empty source disabled the action; submitting source displayed matched entries and “Not sent to model”.
- Retranslation: explicit confirmation described model charges, cache bypass, new history and no memoQ replacement; confirmation displayed old/new results and the new terminology check.
- Literal `<desc_id=1>` remained visible beside highlighted terminology. Form controls have accessible names. Browser error log was empty.
- Synthetic screenshots retained locally at `/private/tmp/translation-evidence-desktop.png` and `/private/tmp/translation-evidence-narrow.png`; no customer data was used.

## Delivery boundaries

Windows CI must build the plugin, prepare resources, package Electron and smoke-test the gateway before merge. The release workflow must produce and publish the setup, ZIP, 7z and manifest; verify published digests against the manifest. Real Windows protocol activation (installed and portable), licensed memoQ regression execution and Wayne's actual translation acceptance remain distinct live-environment checks. No licensed memoQ installation is available on this Mac.
