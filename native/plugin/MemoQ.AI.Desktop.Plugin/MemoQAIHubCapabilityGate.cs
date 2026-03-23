using System;
using MemoQ.MTInterfaces;

namespace MemoQAIHubPlugin
{
    internal static class MemoQAIHubCapabilityGate
    {
        public static bool IsLookupConfigured(MemoQAIHubOptions options)
        {
            return options?.GeneralSettings != null
                && options.GeneralSettings.EnableGateway
                && !string.IsNullOrWhiteSpace(options.GeneralSettings.GatewayBaseUrl);
        }

        public static bool IsLanguagePairSupported(LanguagePairSupportedParams args)
        {
            if (args == null)
            {
                return false;
            }

            if (string.IsNullOrWhiteSpace(args.SourceLangCode) || string.IsNullOrWhiteSpace(args.TargetLangCode))
            {
                return false;
            }

            try
            {
                return IsLookupConfigured(new MemoQAIHubOptions(args.PluginSettings));
            }
            catch
            {
                return false;
            }
        }

        public static void EnsureLookupConfigured(MemoQAIHubOptions options)
        {
            if (options?.GeneralSettings == null)
            {
                throw new InvalidOperationException("memoQ AI Hub plugin settings are missing.");
            }

            if (!options.GeneralSettings.EnableGateway)
            {
                throw new InvalidOperationException("memoQ AI Hub gateway is disabled in the plugin settings.");
            }

            if (string.IsNullOrWhiteSpace(options.GeneralSettings.GatewayBaseUrl))
            {
                throw new InvalidOperationException("memoQ AI Hub gateway URL is empty in the plugin settings.");
            }
        }
    }
}
