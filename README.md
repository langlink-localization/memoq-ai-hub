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
- `Providers`: configure OpenAI or OpenAI-compatible providers, test connectivity, and manage enabled models.
- `Builder`: create translation profiles, choose provider routes, bind a TB asset, and adjust the limited v1 advanced switches.
- `Assets`: import and preview glossary or TB assets.
- `History`: inspect translation runs and export or delete history records.

The repository contains runtime code for more advanced capabilities, but not every internal/runtime concept is exposed as a dedicated top-level UI page in the current build. The README and user flow below describe the shipped surface, not every internal module.

## Recent Updates

`v1.0.14` focuses on stabilizing memoQ batch pre-translation:

- The desktop runtime now uses smaller aggregate groups and controlled provider concurrency so large memoQ pre-translation runs do not overload a single provider route.
- Pending aggregate results are polled explicitly, with clearer timeout and error diagnostics instead of long opaque waits.
- Slow aggregate jobs can fall back to single-segment rescue and partial success responses, allowing memoQ to fill completed segments first and retry missing segments separately.
- Plugin and gateway logs include request, trace, job, queue, wait, pending, timeout, and retry details to make provider slowdowns easier to diagnose.

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

1. Install the plugin DLL.
2. Configure a provider.
3. Build a profile in Builder.
4. Review translation history.

If you are setting up the app for the first time, this is the path that matches the shipped UI.

## Upgrade Notes

- Keep the memoQ AI Hub desktop app running while memoQ uses the local gateway.
- If you already installed an older memoQ AI Hub plugin DLL, open the desktop Dashboard after upgrading and click **Install / Reinstall** so memoQ receives the latest `MemoQ.AI.Hub.Plugin.dll`.
- Restart memoQ after reinstalling the integration. memoQ loads plugin DLLs at startup, so a running memoQ instance can keep using the old DLL until it restarts.
- If you install manually, replace `MemoQ.AI.Hub.Plugin.dll` in memoQ's `Addins` directory and then restart memoQ.

## Local Development

Install dependencies and build from the repo root:

```powershell
pnpm install
pnpm run install:desktop
pnpm run build:plugin
pnpm run prepare:release
```

Run desktop tests:

```powershell
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
- `apps/desktop/out/*.zip`
- `apps/desktop/out/make/**/*.exe`

## Documentation

- User guide: [docs/user-guide.md](docs/user-guide.md)
- Chinese user guide: [docs/user-guide.zh-CN.md](docs/user-guide.zh-CN.md)
- Repository structure: [docs/repository-structure.md](docs/repository-structure.md)

## License

MIT. See [LICENSE](LICENSE).
