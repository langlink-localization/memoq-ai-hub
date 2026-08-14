# Third-party notices

memoQ AI Hub depends on third-party software. The applicable license files shipped by Electron/Chromium and packaged JavaScript dependencies remain with the distributed application.

## External build dependency: memoQ MT SDK

The public repository and release package do not include `MemoQ.Addins.Common.dll`, `MemoQ.MTInterfaces.dll`, `MemoQ.AddinSigner.exe`, or other memoQ/Kilgray SDK files.

Plugin compilation requires `MemoQ.Addins.Common.dll` and `MemoQ.MTInterfaces.dll`. Build tooling obtains them directly from the official memoQ SDK endpoint or from a developer-provided `MEMOQ_SDK_DIR`. These assemblies remain governed by memoQ's terms and are not covered by this repository's MIT license.

- Official SDK downloads: https://docs.memoq.com/current/sdk-docs/
- memoQ EULA: https://www.memoq.com/legal/end-user-license-agreement/

## Packaged open-source software

The Electron package includes its Chromium license bundle. Runtime packages copied into the application retain their package license files where the packaging allowlist requires them. The dependency lockfile is the authoritative version inventory for JavaScript dependencies.
