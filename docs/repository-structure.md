# Repository Structure

This repository follows a standard monorepo topology. Runtime code, shared contracts, native integrations, repo-owned tooling, and repository tests each live in dedicated top-level zones.

## Top-Level Taxonomy

- `apps/`: deployable application packages.
- `apps/desktop/`: Electron desktop application, local HTTP gateway, renderer UI, and desktop tests.
- `apps/desktop/src/runtime/runtime.js`: desktop runtime composition root and public API facade; product execution and resource state operations belong in sibling services and stores.
- `apps/desktop/src/runtime/runtimeAggregationService.js`: aggregate request queue owner for grouping, deadlines, congestion state, rescue settlement, and job lifecycle.
- `apps/desktop/src/runtime/runtimeProviderExecution.js`: provider execution boundary for concurrency slots, rate limiting, retries, and per-route throughput history.
- `apps/desktop/src/runtime/runtimeTranslationService.js`: translation product orchestration for route selection, batch splitting, cache use, preview/assets, adaptive fallback, history, and response assembly.
- `apps/desktop/src/runtime/runtimeProfileService.js`: Profile and mapping-rule lifecycle, reference guards, default selection, duplication, and metadata-based resolution.
- `apps/desktop/src/runtime/runtimeProviderService.js`: Provider/model lifecycle, draft testing, discovery, secret coordination, validation, and reference guards.
- `apps/desktop/src/runtime/runtimeAssetService.js`: imported asset file lifecycle, profile-reference protection, and parsed-cache eviction.
- `apps/desktop/src/runtime/runtimePreviewContextResolver.js`: Preview context owner for cache warmup, local/shared context lookup, document-summary caching, and resolver diagnostics.
- `apps/desktop/src/runtime/runtimeQaService.js`: Preview QA and Assistant orchestration owner for payload preparation, coordinator state, automatic checks, cancellation, and document QA.
- `apps/desktop/src/runtime/runtimePersistence.js`: desktop persistence owner for schema DDL, versioned `user_version` migrations, history/cache/QA storage, and legacy-state import.
- `apps/desktop/src/gatewayRequestValidation.js`: gateway POST payload shape validation for object bodies and per-route required fields before runtime dispatch.
- `apps/desktop/src/shared/appStateDefaults.js`: single-source placeholder app-state slices shared by the main-process startup placeholder and the renderer fallback.
- `apps/desktop/src/renderer/src/appState.mjs`: renderer-side remote state defaults, defensive payload normalization, and refresh-time metric preservation.
- `apps/desktop/src/renderer/src/providerDraftState.mjs`: Provider editor draft construction, model selection/catalog projection, request preview, and change fingerprints.
- `apps/desktop/src/renderer/src/pages/providers/providerPresentation.mjs`: Provider status/type presentation and search normalization shared by the App shell and Providers page.
- `apps/desktop/src/renderer/src/profileDraftState.mjs`: Profile defaults, unified route selection, asset-binding projection, and change fingerprints.
- `apps/desktop/src/renderer/src/pages/logs/logPresentation.mjs`: log payload normalization, diagnostic projection, byte formatting, and grouped-file flattening.
- `apps/desktop/src/renderer/src/pages/assets/assetPresentation.mjs`: asset-library categories, usage projection, preview rows, and TB-structure presentation rules.
- `apps/desktop/src/provider/providerTransportSupport.js`: provider transport facade for text, structured, and streaming calls, including SDK client construction, timeout/cancellation, Retry-After handling, structured-output negotiation, and prompt-cache fields.
- `native/plugin/MemoQ.AI.Desktop.Plugin/MemoQAIHubGatewayClient.cs`: thin gateway transport boundary for direct/aggregate request selection, concurrency limits, result polling, and direct fallback; the memoQ session retains segment/request orchestration.
- `native/plugin/MemoQ.AI.Desktop.Plugin/MemoQAIHubContract.cs`: plugin-side contract constants and the gateway contract-version handshake reference verified against `/desktop/version`.
- `native/plugin/MemoQ.AI.Desktop.Plugin/MemoQAIHubRequestMapper.cs`: memoQ-to-gateway request adapter for metadata index remapping, segment serialization, request types, profile hints, and capability flags.
- `native/plugin/MemoQ.AI.Desktop.Plugin/MemoQAIHubResponseMapper.cs`: gateway-to-memoQ response adapter for index validation, error mapping, tag/format conversion, whitespace normalization, and confidence projection.
- `native/plugin/MemoQ.AI.Desktop.Plugin/MemoQAIHubPluginLogger.cs`: plugin-local trace/file logging, rotation, and retention boundary.
- `native/`: .NET and host-specific runtime integrations.
- `native/plugin/`: memoQ MT plugin source; SDK binaries are resolved into an ignored local cache.
- `native/preview-helper/`: auxiliary .NET executable used by desktop preview flows.
- `packages/`: cross-runtime contracts and reusable shared payloads.
- `packages/contracts/`: versioned files shared across runtime boundaries.
- `tooling/`: repository-owned automation and build entrypoints.
- `tooling/scripts/`: release and packaging scripts invoked from the repository root or CI.
- `tooling/build/`: build-time staging helpers and packaging preparation scripts.
- `tests/repo/`: repository-level contract, topology, and tooling tests.
- `docs/`: contributor-facing, project-authored documentation and links to external references.
- `assets/`: checked-in static assets that are neither source code nor generated output.

## Placement Rules

- New runtime code belongs in `apps/`, `native/`, or `packages/`, never at the repository root.
- New shared payloads, schemas, or runtime contracts belong in `packages/contracts/`.
- New repo-owned automation belongs in `tooling/scripts/` or `tooling/build/`, not inside runtime modules.
- New repository-level tests belong in `tests/repo/`.
- Do not mirror vendor SDKs, binaries, tools, sample source, or documentation. `docs/reference/` contains links to authoritative external sources only.
- Root-level files stay minimal: workspace manifests, lockfiles, README, implementation plan, git metadata, and CI metadata only.

## Canonical Documentation Layout

- `docs/repository-structure.md` is the structure policy and contributor entrypoint for repository layout.
- `docs/reference/` points contributors to authoritative vendor sources without copying their content into this public repository.
- New project documentation should be added under `docs/` unless it belongs inside a specific runtime module.

## Generated Output Policy

The following locations are generated outputs or local scratch space and must not become sources of truth:

- `apps/desktop/.vite/`
- `apps/desktop/out/`
- `apps/desktop/make/`
- `apps/desktop/test-output/`
- `apps/desktop/build-resources/memoq-integration/`
- `apps/desktop/helper/`
- `.tmp/`
- `.worktrees/`
- `artifacts/`
- `.memoq-sdk/`
- `native/plugin/**/bin/`
- `native/plugin/**/obj/`
- `native/preview-helper/**/bin/`
- `native/preview-helper/**/obj/`
- `native/preview-helper/**/obj-*/`

If a new build step creates another transient directory, add it to `.gitignore` and document the owning script before committing.

## Migration Guardrails

- Legacy root folders such as `desktop/`, `plugin/`, `preview-helper/`, `shared-contracts/`, `scripts/`, `build/`, and `test/` must not be reintroduced.
- Path-sensitive entrypoints in workflows, PowerShell scripts, release metadata, and desktop runtime path resolvers must point at the monorepo zones above.
- Do not commit generated outputs unless the repository explicitly treats them as release inputs and the owning script/doc is updated in the same change.
