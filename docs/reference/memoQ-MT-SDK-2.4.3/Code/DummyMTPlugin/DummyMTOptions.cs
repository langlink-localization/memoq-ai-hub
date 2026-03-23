namespace DummyMTPlugin
{
    /// <summary>
    /// Class for storing the Dummy MT plugin settings.
    /// </summary>
    /// <remarks>
    /// Implementation checklist:
    ///     - There is an options class, with proper generic and secure subclasses (the secure options class can be omitted).
	///     - The options class is a simple entity class, does not call any services, and simply gives back the saved or the default settings.
	///     - The options class does not store/load its own settings.
    /// </remarks>
    public class DummyMTOptions : MemoQ.MTInterfaces.PluginSettingsObject<DummyMTGeneralSettings, DummyMTSecureSetting>
    {
        /// <summary>
        /// Create instance by deserializing from provided serialized settings.
        /// </summary>
        public DummyMTOptions(MemoQ.MTInterfaces.PluginSettings serializedSettings)
            : base(serializedSettings)
        {
        }

        /// <summary>
        /// Create instance by providing the settings objects.
        /// </summary>
        public DummyMTOptions(DummyMTGeneralSettings generalSettings, DummyMTSecureSetting secureSettings)
            : base(generalSettings, secureSettings)
        {
        }
    }

    /// <summary>
    /// General settings, content preserved when settings are exported.
    /// </summary>
    public class DummyMTGeneralSettings
    {
        public string LogFileLocation;
        public string[] SupportedLanguages = new string[0];
        public FormattingAndTagsUsageOption FormattingAndTagUsage;
    }

    /// <summary>
    /// Settings, whether inline tags and/or formatting should be included in the request sent to the machine translation provider.
    /// </summary>
    public enum FormattingAndTagsUsageOption
    {
        Plaintext = 0,
        OnlyFormatting = 1,
        BothFormattingAndTags = 2,
    }

    /// <summary>
    /// Secure settings, content not preserved when settings leave the machine.
    /// </summary>
    public class DummyMTSecureSetting
    {
        /// <summary>
        /// The user name used to be able to use the MT service.
        /// </summary>
        public string UserName = string.Empty;
        /// <summary>
        /// The password used to be able to use the MT service.
        /// </summary>
        public string Password = string.Empty;
    }
}
