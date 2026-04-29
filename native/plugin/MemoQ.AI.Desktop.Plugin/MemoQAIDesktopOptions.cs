using System.Xml.Serialization;
using MemoQ.MTInterfaces;

namespace MemoQAIHubPlugin
{
    public class MemoQAIHubOptions : PluginSettingsObject<MemoQAIHubGeneralSettings, MemoQAIHubSecureSettings>
    {
        public MemoQAIHubOptions(PluginSettings serializedSettings)
            : base(serializedSettings)
        {
        }

        public MemoQAIHubOptions(MemoQAIHubGeneralSettings generalSettings, MemoQAIHubSecureSettings secureSettings)
            : base(generalSettings, secureSettings)
        {
        }
    }

    public class MemoQAIHubGeneralSettings
    {
        public string GatewayBaseUrl = "http://127.0.0.1:5271";
        public int GatewayTimeoutMs = 300000;
        public bool EnableGateway = true;
        public bool EnableCustomDisplayName = false;
        public string CustomDisplayName = "memoQ AI Hub";
        public string PreferredProfileId = string.Empty;
        public FormattingAndTagsUsageOption FormattingAndTagUsage = FormattingAndTagsUsageOption.BothFormattingAndTags;
    }

    public class MemoQAIHubSecureSettings
    {
    }

    public enum FormattingAndTagsUsageOption
    {
        [XmlEnum("Plaintext")]
        Plaintext = 0,
        [XmlEnum("Html")]
        OnlyFormatting = 1,
        [XmlEnum("Xml")]
        BothFormattingAndTags = 2
    }
}
