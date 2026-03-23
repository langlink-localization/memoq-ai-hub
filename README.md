# memoQ AI Hub

[English](README.md) | [简体中文](README.zh-CN.md)

## Overview

`memoQ AI Hub` is a local AI translation console for memoQ. The core idea is inspired by [JuchiaLu/Multi-Supplier-MT-Plugin](https://github.com/JuchiaLu/Multi-Supplier-MT-Plugin).

Instead of keeping all translation logic inside one memoQ plugin DLL, this project uses a "thin DLL + local desktop app" architecture. The memoQ plugin stays focused on SDK integration, segment conversion, and local communication, while the desktop app handles provider configuration, prompt orchestration, asset management, history, cache, and installation diagnostics.

## What It Does

- Routes memoQ MT plugin requests through a local desktop gateway, then calls OpenAI or OpenAI-compatible services from one place.
- Centralizes provider, model, API key, prompt strategy, and runtime settings in the desktop app.
- Builds translation context from language metadata, neighboring segments, terminology assets, briefs, TM data, and preview-derived context.
- Records translation history, success rate, latency, and operational signals for troubleshooting and tuning.
- Supports `StoreTranslation` write-back so confirmed translations become reusable adaptive cache entries.
- Packages the memoQ plugin DLL, `ClientDevConfig.xml`, and desktop-side integration assets together.

## Core Approach

The runtime is split into four layers:

- `native/plugin/`: the thinnest possible memoQ plugin layer, implementing the memoQ MT SDK surface, converting segments, forwarding metadata and TM data, and calling the local HTTP gateway.
- `apps/desktop/`: the Electron desktop app, responsible for provider orchestration, context building, history, cache, local services, and install diagnostics.
- `native/preview-helper/`: preview support used to supply document-level context and preview-related data to the desktop runtime.
- `packages/contracts/`: the shared HTTP contract between the DLL and the desktop app.

The design choice is simple: memoQ plugins are good host adapters, but not a good place for fast-changing AI logic. Moving the complex behavior into a desktop runtime makes debugging, extension, packaging, release, and future UI work much easier.

## Request Flow

1. memoQ calls the local plugin DLL.
2. The plugin converts segments, language pair, request type, and TM or metadata fields into a normalized request and sends it to the local gateway at `http://127.0.0.1:5271`.
3. The desktop runtime reads the active profile and provider configuration to choose the model and parameters.
4. The desktop runtime assembles prompts and context, including terminology, briefs, preview context, adjacent text, and history-driven policy.
5. The provider registry calls an OpenAI or compatible API and normalizes the result.
6. The result is written back into history, metrics, and cache. Adaptive cache hits can short-circuit later requests.
7. The plugin converts the returned text back into a memoQ-compatible result and hands it back to memoQ.

`StoreTranslation` works in the reverse direction: once a user confirms a translation inside memoQ, the plugin sends the source and target text back to the desktop runtime so they can be stored as reusable cache entries.

## Repository Structure

- Runtime modules: `apps/desktop/`, `native/plugin/`, `native/preview-helper/`, `packages/contracts/`
- Engineering support: `tooling/scripts/`, `tooling/build/`, `.github/workflows/`
- Docs and reference material: `docs/`
- Static assets: `assets/`
- Repo-level tests: `tests/repo/`

See `docs/repository-structure.md` for repository structure and extension rules.

## Local Development

```powershell
pnpm install
pnpm run install:desktop
pnpm run build:plugin
pnpm run prepare:release
cd apps/desktop
pnpm start
```

Default gateway base URL: `http://127.0.0.1:5271`

## Packaging And Release

This repository includes GitHub Actions:

- `.github/workflows/ci.yml`: runs build, tests, and Windows packaging checks on pushes to `main` and on pull requests.
- `.github/workflows/release.yml`: runs the release packaging flow on `v*` tags and uploads `apps/desktop/out/**/*.zip` to GitHub Releases.

Local packaging command:

```powershell
pnpm run package:windows
```

Primary outputs:

- `native/plugin/MemoQ.AI.Desktop.Plugin/bin/Release/net48/MemoQ.AI.Hub.Plugin.dll`
- `apps/desktop/out/*.zip`
- `apps/desktop/out/make/**/*.exe`
- `apps/desktop/build-resources/memoq-integration/*`

## License

This project is released under the MIT License. See `LICENSE`.
