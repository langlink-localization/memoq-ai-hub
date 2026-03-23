# Repository Structure

This repository follows a standard monorepo topology. Runtime code, shared contracts, native integrations, repo-owned tooling, and repository tests each live in dedicated top-level zones.

## Top-Level Taxonomy

- `apps/`: deployable application packages.
- `apps/desktop/`: Electron desktop application, local HTTP gateway, renderer UI, and desktop tests.
- `native/`: .NET and host-specific runtime integrations.
- `native/plugin/`: memoQ MT plugin source and checked-in binary references.
- `native/preview-helper/`: auxiliary .NET executable used by desktop preview flows.
- `packages/`: cross-runtime contracts and reusable shared payloads.
- `packages/contracts/`: versioned files shared across runtime boundaries.
- `tooling/`: repository-owned automation and build entrypoints.
- `tooling/scripts/`: release and packaging scripts invoked from the repository root or CI.
- `tooling/build/`: build-time staging helpers and packaging preparation scripts.
- `tests/repo/`: repository-level contract, topology, and tooling tests.
- `docs/`: contributor-facing documentation and vendor/reference material.
- `assets/`: checked-in static assets that are neither source code nor generated output.

## Placement Rules

- New runtime code belongs in `apps/`, `native/`, or `packages/`, never at the repository root.
- New shared payloads, schemas, or runtime contracts belong in `packages/contracts/`.
- New repo-owned automation belongs in `tooling/scripts/` or `tooling/build/`, not inside runtime modules.
- New repository-level tests belong in `tests/repo/`.
- New vendor or SDK reference material belongs in `docs/reference/`.
- Root-level files stay minimal: workspace manifests, lockfiles, README, implementation plan, git metadata, and CI metadata only.

## Canonical Documentation Layout

- `docs/repository-structure.md` is the structure policy and contributor entrypoint for repository layout.
- `docs/reference/` holds curated memoQ SDK notes, reference configuration files, and lightweight supporting material that can live in a public repository.
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
