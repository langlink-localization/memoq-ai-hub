using System.Drawing;
using MemoQ.MTInterfaces;

namespace MemoQAIHubPlugin
{
    public class MemoQAIHubEngine : EngineBase
    {
        private readonly string _sourceLangCode;
        private readonly string _targetLangCode;
        private readonly MemoQAIHubOptions _options;

        public MemoQAIHubEngine(string sourceLangCode, string targetLangCode, MemoQAIHubOptions options)
        {
            _sourceLangCode = sourceLangCode;
            _targetLangCode = targetLangCode;
            _options = options;
        }

        public override int MaxDegreeOfParallelism => 8;

        public override bool SupportsFuzzyCorrection => false;

        public override Image SmallIcon => MemoQAIHubPluginDirector.CreateDisplayIconCopy();

        public override ISession CreateLookupSession()
        {
            return new MemoQAIHubSession(_sourceLangCode, _targetLangCode, _options);
        }

        public override ISessionForStoringTranslations CreateStoreTranslationSession()
        {
            return MemoQAIHubCapabilityGate.IsLookupConfigured(_options)
                ? new MemoQAIHubSession(_sourceLangCode, _targetLangCode, _options)
                : new MemoQAIHubDisabledStoreTranslationSession();
        }

        public override void SetProperty(string name, string value)
        {
        }

        public override void Dispose()
        {
        }
    }
}
