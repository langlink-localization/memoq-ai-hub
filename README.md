# memoQ AI Hub

[English](README.md) | [简体中文](README.zh-CN.md)

## Overview

`memoQ AI Hub` is a local desktop gateway for memoQ AI translation workflows.

The project uses a thin memoQ plugin DLL plus a local Electron app:

- The memoQ plugin DLL stays focused on memoQ SDK integration and local request forwarding.
- The desktop app handles provider setup, profile building, terminology assets, history, cache, install diagnostics, and packaging.

This keeps fast-changing AI logic out of the memoQ plugin itself and makes local debugging and release packaging much easier.

## What Is Actually Enabled Today

The current desktop app exposes these operator-facing modules:

- `Dashboard`: install or reinstall the memoQ integration, check runtime status, and review update state.
- `AI Services`: configure OpenAI or OpenAI-compatible providers, test connectivity, and manage enabled models.
- `Setup`: create translation profiles, choose provider routes, bind terminology and Custom TM assets, select TM score buckets, and configure optional context features.
- `Project Rules`: route memoQ projects to saved Profiles by client, domain, subject, project, language pair, document regex, or segment status, then test the result before translation.
- `Assets`: import and preview glossary, TB, TMX, and table-based Custom TM assets.
- `Translation Records`: inspect translation runs, Custom TM matches, prompts, and diagnostics, then export or delete records.
- `Quality Checks`: inspect the active Preview segment with observable deterministic/AI execution details, review and export local QA history, manage scoped QA/Translate/Polish prompt presets, open the two-mode Translate/Polish and QA Assistant, import MQXLIFF/XLIFF files read-only, and export HTML/CSV/JSON reports.
- `Logs`: review local diagnostic logs, open log files, clean old logs, and copy a short support summary.

The repository contains runtime code for more advanced capabilities, but not every internal/runtime concept is exposed as a dedicated top-level UI page in the current build. The README and user flow below describe the shipped surface, not every internal module.

## Current Release Highlights

`v1.0.40` includes the product, performance, security, architecture, and reliability improvements delivered from `v1.0.20` through `v1.0.40`:

- Project Rules now exposes the existing metadata-routing engine as a complete operator workflow: create, edit, copy, enable, disable, delete, inspect hit counts, and test rules against memoQ project metadata.
- Profiles can bind uploaded TMX or table-based Custom TM assets and choose which `AI Hub TM score` buckets are sent to AI. Context-aware TMX matches can reach `101%`, while memoQ's own fuzzy hint remains a separate reference.
- The five-step setup journey, responsive navigation, protected unsaved edits, accessible controls, and focused Translation Records views make day-to-day configuration and diagnostics easier.
- Lazy loading and packaging cleanup reduce startup memory and package size; both the standard ZIP and smaller 7z portable packages remain available.
- The local gateway is restricted to loopback, update navigation is HTTPS-only, and managed downloads are verified against SHA-256 metadata before launch.
- Desktop worker requests are bounded, Provider secrets fail closed when Windows secure storage is unavailable, and static analysis is enforced in CI.
- Local database commits now use validated atomic replacement with a last-known-good recovery backup; malformed and oversized gateway requests also return stable JSON errors.
- Standalone and worker-local runtimes can no longer create reversible credential files, and the runtime benchmark now measures the production worker composition explicitly.
- Renderer refresh, polling, history-detail, and shell lifecycle behavior now lives behind focused hooks, and CI rejects every ESLint warning instead of carrying React Hooks debt.
- Electron and desktop dependencies have been moved to security-maintained versions, with Node.js 22.12 or newer required only for source builds.
- The repository and release packages no longer include memoQ SDK binaries, AddinSigner, or official SDK samples. Source builds resolve the two required compile-time assemblies into an ignored local cache.
- The memoQ plugin and desktop gateway now verify the shared contract version against each other before the first request, gateway POST payloads are shape-validated up front, and the local database gained versioned schema migrations.
- The renderer app shell was decomposed into focused page-domain hooks and components, the renderer IPC surface is generated from a single table shared by preload and main, and the runtime gained explicit history-presentation and state-view services.
- Strict type checking (JSDoc annotations checked by `tsc --noEmit`) now gates the shared contract layer, the QA and bilingual modules, the entire asset parser layer, the provider config/governance/response/transport/prompt-builder/registry modules, and the renderer IPC surface through `pnpm run typecheck` and a CI step.

## Runtime Layout

- `native/plugin/`: memoQ MT plugin implementation and packaging assets.
- `apps/desktop/`: Electron desktop app, local worker, renderer UI, and local gateway.
- `native/preview-helper/`: preview helper used for richer document context.
- `packages/contracts/`: shared desktop/plugin contract metadata.

## Request Flow

1. memoQ calls the local plugin DLL.
2. The DLL normalizes the request and forwards it to the local desktop gateway at `http://127.0.0.1:5271`.
3. The desktop runtime resolves the active profile and provider route.
4. The runtime assembles context from profile settings, metadata, TB assets, preview context, TM hints, and cache policy.
5. The provider registry calls an OpenAI or OpenAI-compatible API.
6. The result is written back into history and cache, then returned to memoQ.

Confirmed translations can also flow back through `StoreTranslation` so the desktop runtime can reuse them as adaptive cache entries later.

## Actual Setup Order

The current dashboard and user flow are aligned around this order:

1. Install or repair the memoQ integration.
2. Connect and test an AI service.
3. Upload optional terminology or translation-memory assets.
4. Create and save a translation profile in Setup.
5. Optionally add and test Project Rules to select a Profile from memoQ project metadata.
6. Run a translation in memoQ and review the translation record.

If you are setting up the app for the first time, this is the path that matches the shipped UI.

## Upgrade Notes

- Keep the memoQ AI Hub desktop app running while memoQ uses the local gateway.
- If you already installed an older memoQ AI Hub plugin DLL, open the desktop Dashboard after upgrading and click **Install / Reinstall** so memoQ receives the latest `MemoQ.AI.Hub.Plugin.dll`.
- Restart memoQ after reinstalling the integration. memoQ loads plugin DLLs at startup, so a running memoQ instance can keep using the old DLL until it restarts.
- If you install manually, replace `MemoQ.AI.Hub.Plugin.dll` in memoQ's `Addins` directory and then restart memoQ.

## Local Development

The repository does not contain memoQ SDK binaries. Plugin builds download the pinned memoQ MT SDK 2.4.4 archive from memoQ's official documentation site, verify its SHA-256 digest, and extract only the two required compile-time assemblies into the ignored `.memoq-sdk/` cache. To use an SDK or installed memoQ directory you already manage, set `MEMOQ_SDK_DIR` to a directory containing `MemoQ.Addins.Common.dll` and `MemoQ.MTInterfaces.dll`.

Review the [memoQ EULA](https://www.memoq.com/legal/end-user-license-agreement/) before using the SDK. Downloading SDK files does not place them under this repository's MIT license.

`pnpm run test:plugin` is a runtime regression test and requires a locally licensed memoQ installation. It auto-detects standard memoQ installations; set `MEMOQ_RUNTIME_DIR` to override the installation directory.

Install dependencies and build from the repo root:

```powershell
pnpm install
pnpm run install:desktop
pnpm run build:plugin
pnpm run test:plugin
pnpm run prepare:release
```

Run desktop tests:

```powershell
pnpm run lint
pnpm run test:desktop
pnpm run test:repo
```

Start the Electron app:

```powershell
cd apps/desktop
pnpm start
```

Default local gateway:

```text
http://127.0.0.1:5271
```

## Packaging

Common packaging commands:

```powershell
pnpm run package:desktop
pnpm run zip:desktop
pnpm run package:windows
```

Typical outputs include:

- `native/plugin/MemoQ.AI.Desktop.Plugin/bin/Release/net48/MemoQ.AI.Hub.Plugin.dll`
- `apps/desktop/out/memoq-ai-hub-win32-x64.7z` (smallest portable archive)
- `apps/desktop/out/memoq-ai-hub-win32-x64.zip` (compatibility archive)
- `apps/desktop/out/make/**/*.exe`

## Documentation

Repository Structure guidance lives under `docs/`; keep desktop code under `apps/desktop/` and shared scripts under `tooling/scripts/`.

- User guide: [docs/user-guide.md](docs/user-guide.md)
- Chinese user guide: [docs/user-guide.zh-CN.md](docs/user-guide.zh-CN.md)
- Repository structure: [docs/repository-structure.md](docs/repository-structure.md)

## License

LangLink-owned portions are available under the MIT License. See [LICENSE](LICENSE), [LICENSE_SCOPE.md](LICENSE_SCOPE.md), and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). memoQ SDK materials and trademarks are not covered by the MIT license, and this is not an official memoQ product.
