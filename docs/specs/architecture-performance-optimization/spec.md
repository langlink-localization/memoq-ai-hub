# Architecture and Performance Optimization Specification

## Goal

Improve memoQ AI Hub's architecture and its representative runtime startup time, packaged application size, and initialized runtime memory by at least 20% each without changing shipped behavior or public/runtime contracts.

## Context

The desktop application combines an Electron renderer, a local gateway worker, provider integrations, asset parsers, SQL-backed persistence, update support, and native memoQ integration. The renderer and worker currently have broad eager dependency surfaces, while the production package includes Electron, built application code, runtime dependencies, and native resources. Optimizations must be driven by repeatable measurements rather than source-size intuition.

## Repositories In Scope

- `memoq-ai-hub`: source of truth and only write target.

## Source Of Truth

- Goal and acceptance contract: this specification.
- Initiative state: `docs/initiatives/architecture-performance-optimization.yaml`.
- Raw benchmark evidence: JSON files in this specification directory.
- Behavioral compatibility: repository tests, desktop tests, production build/package, and existing contracts.
- UI behavior: `docs/ui-governance.md`.

## Metric Contract

All comparisons use Windows Node.js 22.19.0, the locked pnpm dependency graph, the same machine, the same commit worktree topology, and no external provider calls.

1. **Runtime startup**: median `runtimeStartupMs` across seven fresh child processes. Each process measures CommonJS loading of `src/runtime/runtime.js` plus `createRuntime()` initialization with a fresh temporary app-data directory and a read of the initial app state.
2. **Runtime memory**: median `runtimeRssDeltaBytes` from the same seven processes, calculated as RSS after initialized state is materialized minus RSS immediately before loading the runtime module. Absolute initialized RSS and per-run samples are retained for diagnosis.
3. **Package size**: bytes of the smallest complete user-delivered portable archive produced by `pnpm run zip:desktop`. The baseline is the existing ZIP because it was the only published archive. The final workflow may add a more compact archive only if it contains the same complete packaged directory and keeps the existing ZIP for compatibility. The complete Electron Forge directory total, application payload, ASAR, locale, and largest-file breakdowns are retained as diagnostics.

For time and memory, seven isolated samples limit warm-process cache contamination and the median limits one-off host noise. Baseline and final measurements must use the repository-owned benchmark script and preserve every sample.

## Constraints

- Preserve memoQ plugin, local HTTP, persisted-data, Provider, Profile, Asset, History, update, localization, and desktop IPC contracts.
- Do not remove features, supported file formats, locales, diagnostics, validation, or correct work to improve a metric.
- Do not disable, weaken, or bypass tests, and never use `--no-verify`.
- Keep changes incremental and reversible; every optimization must map to measured evidence.
- Preserve React 18, Ant Design 5, Electron 30, pnpm, and the existing .NET integration unless a separately verified migration becomes necessary.
- Do not commit generated Electron output, secrets, machine-local state, or benchmark temporary directories.

## Non-goals

- Provider/network latency optimization, because external service variance cannot produce a reproducible local baseline.
- Rebranding, workflow redesign, or removal of advanced capabilities.
- Publishing a release, modifying remote GitHub state, or changing another repository.
- Claiming architecture improvement solely from file moves or abstraction count.

## Architecture Direction

- Keep the native plugin thin and the local worker authoritative for AI behavior.
- Reduce eager dependency and module surfaces at process and renderer startup.
- Split responsibilities only where the boundary enables independent loading, testing, or lifecycle control.
- Remove package duplication and unreachable delivery content without changing runtime resolution.
- Prefer explicit lazy factories and feature-boundary loading over global registries or implicit side effects.

## Rollout Waves

1. **Contract and baseline**: add the benchmark harness, capture fresh metrics, and verify current gates.
2. **Runtime boundary**: reduce eager worker dependencies and unnecessary initialized state while preserving APIs.
3. **Renderer and delivery boundary**: split non-initial UI modules and remove redundant packaged content.
4. **Verification and hardening**: run full regression, package, repeated final benchmarks, and self-review.

Each wave must keep its targeted tests green and leave a reversible diff.

## Verification Gates

- Runtime startup median improves by at least 20% from the recorded baseline.
- Runtime RSS delta median improves by at least 20% from the recorded baseline.
- Fresh compact portable archive bytes improve by at least 20% from the recorded baseline while the compatible ZIP remains available.
- `pnpm run test:desktop` and `pnpm run test:repo` pass with no new skips.
- Renderer production build and Electron Forge package complete successfully.
- Existing desktop contract, packaging, preload surface, runtime, asset parsing, provider, and component-interaction tests remain green.
- Final review maps each metric to raw samples and each architectural change to compatibility evidence.

## Done When

All three metrics independently meet the 20% threshold under the metric contract, every verification gate passes, the verification report contains baseline/final samples and exact commands, no high-priority self-review findings remain, and the initiative ledger has no remaining next action.

## Rollback Condition

Rollback an optimization slice if it breaks a persisted/public/runtime contract, changes a supported workflow, introduces a new test failure or skip, makes production packaging incomplete, or cannot show a repeatable benefit in its targeted metric.

## GitHub Tracking

- Project: pending; no remote write authorized.
- Issues: pending; current work is thread-goal and branch scoped.
- Pull request: pending user authorization.
