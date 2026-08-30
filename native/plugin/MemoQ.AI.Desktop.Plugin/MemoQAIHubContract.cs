using System;

namespace MemoQAIHubPlugin
{
    // Wire contract facts the plugin stamps into every gateway request and
    // verifies against the live gateway through the /desktop/version handshake.
    // The desktop app keeps its own copy in packages/contracts/desktop-contract.json;
    // the handshake is what keeps the two sources compatible at runtime.
    internal static class MemoQAIHubContract
    {
        public const string Version = "1";
        public const string DesktopVersionPath = "/desktop/version";
        public const int HandshakeTimeoutMs = 15000;
    }
}
