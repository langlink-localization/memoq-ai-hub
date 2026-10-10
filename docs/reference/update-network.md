# Update networking and recovery

Available starting with v1.0.54.

## System proxy

Desktop update checks and package downloads use Electron's Chromium network stack in a dedicated in-memory session with `mode: 'system'`. Proxy configuration is refreshed before each request, including PAC rules. Users do not need to enter a proxy port in AI Hub. Whether a destination uses a proxy or a direct route remains a decision of the system configuration.

A proxy application must expose its configuration through the operating system, or route traffic through its tunnel. Merely running a proxy application does not guarantee that update traffic uses it. AI Hub does not change OS settings or the networking used for translation providers.

If a proxy requires interactive authentication, the update UI directs the user to the browser download option. AI Hub does not save proxy credentials or silently retry with a forced direct connection.

## Download experience

- **Download latest release** remains available for installed and portable builds, including while downloading or after an error.
- Downloads show byte progress and transfer speed; a progress bar appears when the total size is known.
- **Cancel download** stops the transfer and removes its partial file. Failed downloads can be retried.
- Retries download the complete package again; resumable and incremental updates are not implemented.
- Downloads stop after 45 seconds without data or 30 minutes overall. Manifest checks retain their shorter timeout, including response-body reads.
- HTTPS redirect validation and SHA-256 verification remain required before installation or portable preparation.

## Implementation and validation

The main process owns Electron network requests. The worker retains update state, streaming file writes, and checksum verification. Pull-based IPC limits each body message to 256 KiB. Worker exit and application shutdown close active requests.

Local validation covers proxy refresh, redirects, cancellation, stalled responses, stream size limits, retries, and button availability. An Electron 44.4.5 check on macOS detected the configured system proxy and fetched the GitHub manifest through its release-asset redirect. Windows testing with FlClash or other proxy applications is still required before claiming those specific environments are verified.

References: [Electron net](https://www.electronjs.org/docs/latest/api/net), [session proxy configuration](https://www.electronjs.org/docs/latest/api/session#sessetproxyconfig), and [ClientRequest](https://www.electronjs.org/docs/latest/api/client-request).
