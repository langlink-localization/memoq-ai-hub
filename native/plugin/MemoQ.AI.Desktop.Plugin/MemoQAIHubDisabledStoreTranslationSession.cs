using System;
using MemoQ.MTInterfaces;

namespace MemoQAIHubPlugin
{
    internal class MemoQAIHubDisabledStoreTranslationSession : ISessionForStoringTranslations
    {
        private const string Message = "Translation writeback is not supported by the current memoQ AI Hub desktop gateway contract.";

        public void StoreTranslation(TranslationUnit transunit)
        {
            throw new NotSupportedException(Message);
        }

        public int[] StoreTranslation(TranslationUnit[] transunits)
        {
            throw new NotSupportedException(Message);
        }

        public void Dispose()
        {
        }
    }
}
