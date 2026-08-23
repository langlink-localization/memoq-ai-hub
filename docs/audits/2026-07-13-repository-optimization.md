# Repository Optimization Audit — 2026-07-13

## Executive Summary

The repository has a sound product boundary: the native memoQ plugin is thin, the Electron worker owns AI/runtime behavior, shared wire metadata is centralized, and the current architecture/performance initiative has measurable acceptance evidence. The highest-return work is therefore not another broad refactor. It is tightening reproducibility, test isolation, and local desktop trust boundaries.

This audit selected and implemented three initial implementation slices:

1. Track the pnpm lockfile, explicitly allow the required Electron/esbuild install scripts, and make CI/release installs frozen; run repository tests in CI and apply least-privilege CI permissions.
2. Remove the packaging regression test's dependency on an undeclared, stale transitive package.
3. Enforce a loopback-only gateway host, validate the gateway port, restrict external navigation/update URLs to HTTPS, and reject unsafe update artifact names.

The `v1.0.25` follow-up implements the remaining P1 item U1: release-generated SHA-256 metadata plus fail-closed verification of application-managed installer bytes before persistence and again immediately before launch.

No browser or external web source was used when this historical audit was written. Its memoQ capability conclusions used a then-bundled SDK snapshot that has since been removed from the public repository for license hygiene; current work must verify those conclusions against memoQ's official SDK downloads.

## Scope and Evidence

- Baseline commit: `5e906e7` (`v1.0.23`, current `main` when the audit began).
- Repository size: 357 tracked files; approximately 49,995 lines across application, native, tooling, and test surfaces.
- Baseline tests:
  - Repository: 15 passed, 0 failed.
  - Desktop: 403 total; 397 passed, 5 skipped, 1 failed.
  - The sole failure was `forge packaging resolves hoisted ESM-only package roots without a CommonJS export`, because `xml-naming` is neither declared nor present in the current lock graph.
- Dependency reproduction:
  - Generating a lock graph from ranges in offline mode drifted to `@electron-forge/* 7.11.2` and failed because the required archive was not cached.
  - Reusing the existing pnpm 10.6.2 lock graph completed a frozen offline install of 697 packages.
  - pnpm 10 blocks dependency install scripts unless explicitly approved; the clean install identified `electron`, `electron-winstaller`, and `esbuild` as the required build-script allowlist.
  - The final pnpm 10.6.2 offline frozen install completed with the lockfile SHA-256 unchanged at `76fa1f7f47edce30f9c8b9757b54d18f6d68e98512b4ec4f21b4699445957e2f`.
- Prior performance evidence at the same release commit remains valid: runtime startup, runtime RSS delta, and compact package size all exceeded the previous 20% improvement target.

## Architecture Assessment

### Strengths to preserve

- Clear process boundary: memoQ SDK adapter -> loopback gateway -> background runtime -> provider APIs.
- Shared desktop/plugin contract in `packages/contracts/desktop-contract.json`.
- Context isolation enabled and Node integration disabled in the renderer.
- Provider, runtime, asset, preview, packaging, UI interaction, logging, and release behavior have extensive focused tests.
- Sensitive logging keys are redacted and translation content is deliberately omitted.
- Runtime/provider/parser dependencies are lazily loaded; package content has dedicated smoke coverage.
- Database and persistence code use explicit schemas and transaction/rollback paths.
- UI governance already requires locale parity, keyboard behavior, responsive checks, and compile/package verification.

### Concentration risks

- `apps/desktop/src/renderer/src/App.jsx`: 4,423 lines.
- `apps/desktop/src/runtime/runtime.js`: 4,290 lines.
- `apps/desktop/src/provider/providerRegistry.js`: 1,154 lines.
- `native/preview-helper/.../Program.cs`: 1,107 lines.
- `native/plugin/.../MemoQAIDesktopSession.cs`: 1,012 lines.

These files are maintainability hotspots, but a broad split has high regression cost and no immediate user-facing or measurable runtime benefit. Decomposition should follow feature work and preserve the current benchmark protocol.

## Bundled Official SDK Assessment

### memoQ MT SDK 2.4.3

The native plugin follows the documented director/engine/session model:

- It declares interactive, batch, fuzzy-forwarding, and translation-storage capabilities.
- `IsLanguagePairSupported` stays local rather than calling a service, matching the SDK instruction.
- Engine/session construction, batch translation overloads, metadata overloads, `MTException`, and `StoreTranslation` are implemented.
- `MaxDegreeOfParallelism = 8` is valid but should continue to be treated as a per-language upper bound; the SDK explicitly warns that parallelism multiplies across target languages and can trigger rate limits.

Historical evidence came from the memoQ MT SDK 2.4.3 snapshot available when the audit ran. The repository no longer mirrors that material; use the [official memoQ SDK downloads](https://docs.memoq.com/current/sdk-docs/) for current verification.

No immediate SDK-contract correction is justified. Future changes should keep plugin errors inside `TranslationResult.Exception`/`MTException` and retain result-array cardinality for batch calls.

### Preview SDK 9.1

The helper uses the documented named-pipe topology, terminal-session suffix, protocol negotiation, registration/connection, content updates, active preview parts, and preview-part-id requests. Named pipes are a good fit for the current local-only design and avoid running a second unauthenticated callback HTTP service.

Historical evidence came from the Preview SDK 9.1 documentation available when the audit ran. That vendor documentation is no longer mirrored here.

### QA SDK 2.4.3 and terminology boundary

The QA SDK describes quick and batch QA add-ins that emit memoQ-native warnings/errors. The repository's terminology QA is instead an advisory runtime result; it is not a memoQ QA add-in. This is a deliberate product boundary, not a defect.

Historical evidence came from the memoQ QA SDK 2.4.3 documentation available when the audit ran. That vendor documentation is no longer mirrored here.

The bundled MT, QA, and Preview documentation exposes no public TBX/term-base API. A case-insensitive `rg` search for `TBX`, `term base`, `glossary`, and `terminology` across all three SDK documents found only a QA problem category, not an integration API. Current TBX support is therefore correctly implemented as local file import and matching, not represented as memoQ term-base integration.

## Prioritization Method

- Priority: P0 critical now, P1 next delivery, P2 planned, P3 opportunistic.
- Impact, confidence, and effort use 1–5 scales.
- ROI score = `impact × confidence ÷ effort`. It is a comparison aid, not a financial forecast.

| ID | Recommendation | Priority | Impact | Confidence | Effort | ROI | Decision |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| D1 | Track `pnpm-lock.yaml`; frozen installs; correct cache key; run repo tests; least-privilege CI | P1 | 5 | 5 | 1 | 25.0 | Implemented + verified |
| T1 | Make packaging test hermetic instead of relying on `xml-naming` residue | P1 | 4 | 5 | 1 | 20.0 | Implemented + verified |
| S1 | Validate loopback host/port, HTTPS external/update URLs, and artifact filenames | P1 | 4 | 5 | 2 | 10.0 | Implemented + verified |
| Q1 | Resolve two orphan `test.skip` provider prompt cases or replace them with current-contract tests | P2 | 3 | 4 | 2 | 6.0 | Implemented + verified for v1.0.33 |
| R1 | Add bounded main-to-worker request timeouts and cancellation cleanup | P2 | 4 | 4 | 3 | 5.3 | Implemented + verified for v1.0.33 |
| S2 | Make standalone secret-storage mode explicit and fail closed when OS encryption is unavailable | P2 | 4 | 4 | 3 | 5.3 | Implemented + verified for v1.0.33 |
| Q2 | Add lint/static analysis without weakening existing tests | P2 | 3 | 5 | 3 | 5.0 | Implemented + verified for v1.0.33 |
| U1 | Add release-manifest SHA-256 metadata and verify installer bytes before launch | P1 | 5 | 4 | 4 | 5.0 | Implemented + verified for v1.0.25 |
| M1 | Incrementally decompose `App.jsx` and `runtime.js` by feature/lifecycle boundary | P2 | 4 | 5 | 5 | 4.0 | Renderer lifecycle slice implemented + verified for v1.0.35; runtime slice remains backlog |
| N1 | Record provenance/hashes for checked-in memoQ/native binary references and enforce release signing | P2 | 5 | 3 | 4 | 3.8 | Backlog |
| A1 | Normalize malformed JSON/body-limit failures into the gateway's stable JSON error contract | P3 | 2 | 4 | 2 | 4.0 | Implemented + verified for v1.0.34 |
| D2 | Persist the local database atomically and recover from a validated last-known-good generation | P1 | 5 | 5 | 2 | 12.5 | Implemented + verified for v1.0.34 |

## Finding Details

### D1 — Dependency and CI reproducibility

Evidence:

- `.gitignore` ignores `pnpm-lock.yaml`, even though this is a shipped desktop application.
- CI and release cache against `apps/desktop/package.json`, then run non-explicit `pnpm install`.
- The local Windows release packager also runs a non-frozen install before producing public artifacts.
- CI does not run `pnpm run test:repo`, so release metadata, repository topology, and benchmark-contract regressions can merge unnoticed.
- The current package ranges already resolve differently without the existing local lock graph.

Industry-practice target:

- Applications commit their lock graph, use frozen installs in CI/release, and key caches from that lock graph.
- Required native/tool install scripts are allowlisted narrowly rather than enabled globally or left silently skipped.
- Every merge-blocking test suite is represented in CI.
- Read-only CI jobs declare minimal token permissions.

### T1 — Non-hermetic packaging test

Evidence:

- The failing test hard-codes `xml-naming`.
- `xml-naming` is absent from `package.json`, `pnpm-lock.yaml`, and the clean installation.
- The test passed previously only because another dependency graph left the package hoisted in `node_modules`.

Industry-practice target:

- A unit test creates its own temporary ESM-only package fixture and injects resolution roots. It should not depend on accidental transitive packages.

### S1 — Desktop trust-boundary validation

Evidence:

- Product docs and the shared contract define a local gateway at `127.0.0.1`, but `MEMOQ_AI_DESKTOP_HOST` currently accepts any bind address despite having no gateway authentication.
- `shell.openExternal` receives an arbitrary renderer-provided string.
- Update manifest asset URLs and names are accepted without protocol or path validation; names are joined directly under the update download directory.

Industry-practice target:

- Local unauthenticated services fail closed to loopback.
- Privileged shell/navigation IPC validates allowed protocols.
- Remote manifest fields and redirect targets are treated as untrusted input; artifact names cannot contain path separators or Windows-reserved device names, and download URLs require HTTPS.

### U1 — Update authenticity and integrity

The stable manifest now contains lowercase SHA-256 digests for the ZIP and 7z produced by the same packaging run. Packaging fails if either artifact is absent, application-managed installer downloads require a valid digest and verify the response before writing it, and launch re-verifies the managed path and bytes before `shell.openPath`.

Older digest-free manifests remain readable for version checks and portable browser navigation, but they cannot authorize an application-managed installer download. SHA-256 is anchored to the HTTPS-delivered manifest; it detects byte substitution relative to that manifest but does not replace asymmetric manifest signing or platform code signing. Those stronger provenance controls remain under N1.

### R1 — Unbounded worker IPC

Completed in `v1.0.33`. Main-to-worker requests now use 30-second, 135-second, or 10-minute bounded lifecycles by workload. Every response, send failure, worker exit, shutdown, and timeout clears the pending entry and timer; late responses are ignored, and a timeout returns `DESKTOP_WORKER_REQUEST_TIMEOUT` with HTTP status 504 without restarting the worker.

### S2 — Standalone secret-storage ambiguity

Completed in `v1.0.33` and closed across every runtime mode in `v1.0.34`. Provider secrets use the main-process Windows `safeStorage` path end to end. Saving fails closed with `OS_SECRET_STORAGE_UNAVAILABLE` when OS encryption is unavailable; standalone and worker-local modes cannot create reversible credential files; legacy Base64 values remain available only to the verified main-process migration path.

### M1/Q2 — Maintainability and static analysis

Q2 completed in `v1.0.33` with ESLint flat configuration, recommended correctness rules, React Hooks checks, and a main-CI lint gate. The v1.0.35 M1 renderer slice extracted refresh, polling, history-detail, and shell lifecycle boundaries from `App.jsx`, cleared all 20 existing Hooks warnings, and made lint fail on any warning. Runtime decomposition remains backlog and should continue one independently testable boundary at a time rather than as a broad rewrite.

## Selected Implementation Acceptance Criteria

1. `pnpm-lock.yaml` is present in the change set and no longer ignored, remains unchanged by `pnpm install --frozen-lockfile`, required dependency build scripts are explicitly allowlisted, and both CI/release use the lockfile as the cache/install source.
2. CI runs repository and desktop tests and has read-only token permissions.
3. A frozen offline install succeeds in the isolated worktree.
4. The packaging test passes from the locked dependency graph without `xml-naming`.
5. Non-loopback gateway hosts and invalid ports are rejected deterministically.
6. External/update URLs and final redirect targets reject non-HTTPS and credential-bearing URLs; artifact names reject traversal, path separators, trailing dot/space, and Windows-reserved device names.
7. Targeted tests, all desktop tests, repository tests, production renderer build, and native plugin regression/build gates pass.
8. Stable release metadata contains valid SHA-256 digests calculated from the packaged ZIP and 7z, and packaging fails when either artifact is missing.
9. Existing digest-free manifests remain compatible with version checks and portable browser navigation; malformed non-empty digests are rejected.
10. Application-managed installer downloads fail closed when the digest is absent or mismatched and do not persist unverified bytes.
11. Installer launch accepts only the current managed download path and re-verifies its bytes immediately before the operating-system launch call.

## Implemented Changes

### D1 — Reproducible dependency and CI contract

- Added the root `pnpm-lock.yaml` to the repository change set and removed its ignore rule; it will become version-controlled with the eventual commit.
- Added a narrow `pnpm.onlyBuiltDependencies` allowlist for `electron`, `electron-winstaller`, and `esbuild`; no global lifecycle-script bypass was enabled.
- Changed CI and release caches to use the lockfile and installs to use `--frozen-lockfile`.
- Changed the local Windows release packager to use the same frozen-install contract.
- Added repository tests to CI, read-only CI token permissions, and cancellation of superseded CI runs.
- Added repository-level regression assertions for the lockfile, build-script allowlist, frozen installs, cache key, permissions, and repository-test step.

### T1 — Hermetic packaging regression

- Replaced the undeclared `xml-naming` dependency with a temporary ESM-only package fixture owned by the test.
- Added optional resolution roots to `resolvePackageDirectory` solely as a test seam; production defaults and package resolution behavior are unchanged.

### S1 — Desktop trust-boundary hardening

- Restricted the unauthenticated desktop gateway to `127.0.0.1` or `localhost` and validated ports as integers in `1..65535` before startup.
- Centralized external URL validation: HTTPS only, valid URL, and no embedded credentials.
- Applied the validator before `shell.openExternal`, to configured and manifest-provided update URLs, and to final manifest/download redirect targets.
- Rejected update artifact traversal, path separators, invalid Windows filename characters, trailing dot/space, overlong names, and Windows-reserved device names.
- Sanitized unsafe persisted update URLs/assets rather than re-exposing stale values after upgrade.

### U1 — Release and installer byte-integrity contract

- Added SHA-256 fields for both portable artifacts to the stable update manifest and made the release generator hash the actual sibling ZIP and 7z files.
- Preserved digest-free manifests for version checks and browser-based portable downloads while rejecting malformed non-empty digest fields.
- Required valid SHA-256 metadata for application-managed installer downloads, verified response bytes before writing, and removed managed artifacts after integrity failures.
- Added a worker-owned launch gate that validates the current managed path and re-hashes the persisted installer before the main process calls `shell.openPath`.
- Added focused manifest, persistence, mismatch, missing-digest, tamper, and launch-order regression coverage.

## Verification Matrix

| Acceptance area | Fresh verification | Result |
| --- | --- | --- |
| Locked install | pnpm 10.6.2 `install --offline --frozen-lockfile`; SHA-256 before/after | Passed; lock hash unchanged; Electron/esbuild binaries present; no pending builds |
| Focused v1.0.25 integrity/release regression | Release metadata plus update service/main-process verification suites | 30 passed, 0 failed, 0 skipped |
| Full desktop regression | `node --test test/*.test.js test/*.test.mjs` | 417 total; 412 passed, 0 failed, 5 skipped |
| Repository governance | `node --test tests/repo/*.test.mjs` | 19 passed, 0 failed |
| Renderer production build | `pnpm --dir apps/desktop exec vite build --config vite.renderer.config.mjs` | Passed; 3,086 modules transformed |
| Native plugin regression | `dotnet run --project tests/plugin-regression/PluginRegression.csproj -c Release` | Passed all retry, fallback, concurrency, capability, and timeout scenarios |
| Native plugin Release build | `dotnet build native/plugin/MemoQ.AI.Desktop.Plugin/MemoQ.AI.Desktop.Plugin.csproj -c Release` | Passed; 0 warnings, 0 errors |
| Windows release gate | `tooling/scripts/package-windows.ps1 -Configuration Release` | Passed end to end; plugin and Preview helper Release builds, frozen install, 417 desktop tests, Electron Forge package, ZIP/7z archives, digest-bearing stable manifest, and packaged runtime smoke all completed |
| Local artifact integrity | Independent `sha256sum` comparison against the generated stable manifest | Passed for both ZIP and 7z |
| Packaged runtime smoke | `releasePackaging.test.js` with `MEMOQ_AI_PACKAGED_APP_DIR` pointing at the final package | 3 passed: version metadata, `app.asar`, and transitive worker dependencies |
| Static diff check | `git diff --check` | Passed |

The general desktop source suite now has no unconditional skips. The only remaining skips are four artifact-dependent checks in `releasePackaging.test.js`; they run against the freshly generated package during the Windows release gate. No test was disabled or bypassed.

## Delivery Notes and Residual Risk

- Work-item linkage: the initial D1/T1/S1 slices shipped in `v1.0.24`; the dedicated U1 contract is specified in `specs/update-integrity-v1.0.25/spec.md` and targets `v1.0.25`.
- Release preparation: desktop metadata and release notes target `v1.0.25`; the local Windows release gate produced and independently verified the portable ZIP, compact 7z, and digest-bearing stable update manifest.
- Release note candidate: published portable assets now carry SHA-256 metadata, and application-managed installers fail closed unless their manifest digest, downloaded bytes, persisted path, and launch-time bytes agree.
- Documentation sync: this audit and `docs/release-notes/v1.0.25.md` describe the byte-integrity boundary without representing it as asymmetric signing or Windows code signing.
- Rollback watchpoint: D1 is one dependency contract and should be reverted as a unit; reverting only the lockfile or only frozen installs recreates drift.
- Rollback watchpoint: if a legitimate remote gateway or HTTP staging use case appears, do not relax S1 globally. Introduce an authenticated, explicit mode with dedicated tests and migration documentation.
- Rollback watchpoint: do not weaken U1 to accept missing or mismatched digests for in-app installer launch; if an already published contract is defective, disable that path and fix forward with a new patch tag.
- Remaining risk: artifacts are not asymmetrically signed or Windows code-signed (N1); memoQ 12 live-host behavior remains pending and is not claimed by this release.
- Remaining quality debt: M1 remains the incremental runtime/renderer decomposition track. Static analysis is now enforced, while existing React Hooks dependency warnings remain visible for follow-up rather than being suppressed.
- Main CI remains the required gate before creating `v1.0.25`; the release workflow and published-asset digest comparison remain the authoritative remote evidence after the immutable tag is pushed.

## v1.0.33 Reliability Closeout Verification

- `pnpm run lint`: passed with 0 errors; 20 existing React Hooks dependency warnings remain visible for M1 follow-up.
- Desktop regression: 562 total, 558 passed, 0 failed, 4 packaging-only conditional skips.
- Repository governance: 25 passed, 0 failed; Provider registry has no unconditional skips.
- Ant Design scan: 0 findings, 0 skipped files, full scan.
- Plugin regression and Release build: passed; 0 build warnings and 0 errors.
- Windows packaging: passed end to end; all 4 packaging-only checks passed against the final bundle.
- The generated v1.0.33 ZIP and 7z SHA-256 values independently matched the stable manifest.

## v1.0.34 Runtime Integrity Closeout Verification

- `pnpm run lint`: passed with 0 errors; the same 20 visible React Hooks dependency warnings remain assigned to M1.
- Focused runtime-integrity regression: 47 passed, including database generation/recovery, replacement failure, safe-storage migration, fail-closed local secrets, gateway parser failures, and benchmark composition.
- Desktop regression: 578 total, 574 passed, 0 failed, and 4 packaging-only conditional skips.
- Repository governance: 26 passed, 0 failed after release-note contract validation.
- Renderer production build and Ant Design full scan passed; the existing governed UI vendor chunk warning remains visible.
- Plugin build/regression passed with 0 build warnings and 0 errors.
- Windows packaging passed end to end after reusing the already verified local Electron 43.2.0 binary cache when two remote TLS attempts failed; all 4 package-state checks passed.
- Benchmark schema 2 measured a 146.36 ms median runtime startup, 63 loaded modules, a 25.1 MiB median RSS increase, a 321.9 MB unpacked directory, a 4.48 MB ASAR, and a 96.9 MB compact archive across 7 isolated samples.

## v1.0.35 Renderer Maintainability Closeout Verification

- `pnpm run lint`: passed with 0 errors and 0 warnings; `--max-warnings=0` now enforces the same result in main CI.
- Focused lifecycle and renderer-shell contracts: 47 passed, including hidden-window polling, timer cleanup, history-detail cancellation, page-owned refreshes, shell persistence, and dirty-navigation protection.
- Desktop regression: 583 total, 579 passed, 0 failed, and 4 packaging-only conditional skips.
- Repository governance: 26 passed, 0 failed; Ant Design full scan passed with 0 findings and no skipped files.
- Plugin Release build passed with 0 warnings and 0 errors; plugin retry/fallback regression passed.
- Windows packaging passed end to end; all 4 package-state checks passed against the final v1.0.35 bundle.
- The published assets were downloaded independently and matched the published stable manifest: ZIP `aab8915e19d19becd20aec07d9ea7f03d2f7c14c0657dc0203ce7ed5efb04cd5` and 7z `662799545fb80e4a08abf20f988dd2b4e0d5f58d970b236a17d4926c85635392`.
- M1 remains intentionally incremental: the renderer lifecycle slice is complete, while runtime decomposition remains a later item. memoQ 12 live-host verification remains pending and is not claimed by this release.
