# Verification evidence

Shipped: v1.0.53, release commit `44dada39640cb19421709bf9d3b63111feb43a77`. [PR #16](https://github.com/langlink-localization/memoq-ai-hub/pull/16) merged on 2026-10-10 (Asia/Shanghai).

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
- Synthetic screenshots were captured during acceptance; no customer data was used.

## Delivery boundaries

Windows CI built the plugin, prepared resources, packaged Electron and passed the gateway health smoke. The release workflow published the setup, ZIP, 7z and stable manifest; published digests match the manifest. Real Windows protocol activation (installed and portable), licensed memoQ regression execution and Wayne's actual translation acceptance remain distinct live-environment checks. No licensed memoQ installation is available on this Mac.

## Published delivery evidence

- [Final PR CI](https://github.com/langlink-localization/memoq-ai-hub/actions/runs/37967115863): lint, typecheck, 722 desktop tests (718 passed, 4 packaging-dependent skips), 28 repository tests, Windows plugin build, resources, gateway smoke and package passed. The final renderer regressions include cached and mixed-batch prompt labeling.
- [Post-merge main CI](https://github.com/langlink-localization/memoq-ai-hub/actions/runs/37967834215): passed for the release commit. Ant Design lint also passed on both PR and main.
- [Release workflow](https://github.com/langlink-localization/memoq-ai-hub/actions/runs/37968458552): passed. All four packaging-dependent tests ran against the finished bundle and passed with zero skips.
- [v1.0.53](https://github.com/langlink-localization/memoq-ai-hub/releases/tag/v1.0.53): verified latest, non-draft, non-prerelease; English notes match the repository after Windows newline normalization. All four assets are uploaded, and installer/ZIP/7z digests match the stable manifest. The downloaded manifest's own digest matches GitHub's published digest.
- Release assets: setup EXE 143,491,584 bytes; portable ZIP 142,902,960 bytes; compact 7z 92,446,812 bytes; stable manifest 1,079 bytes.
- v1.0.52 remains available for rollback. Preserve local settings and history; update Hub and its bundled plugin together.
