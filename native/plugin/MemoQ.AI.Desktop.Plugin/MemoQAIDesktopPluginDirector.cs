using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Reflection;
using System.Windows.Forms;
using MemoQ.Addins.Common.Framework;
using MemoQ.MTInterfaces;

namespace MemoQAIHubPlugin
{
    public class MemoQAIHubPluginDirector : PluginDirectorBase, IModule
    {
        public const string PluginId = "MemoQ.AI.Hub.Plugin";
        private const string IconResourceName = "MemoQAIHubPlugin.Icon.bmp";
        private static readonly Lazy<Bitmap> DisplayIconBitmap = new Lazy<Bitmap>(LoadDisplayIconBitmap);

        public override IEnvironment Environment
        {
            set
            {
            }
        }

        public void Cleanup()
        {
        }

        public void Initialize(IModuleEnvironment env)
        {
        }

        public bool IsActivated => true;

        public override bool InteractiveSupported => true;

        public override bool BatchSupported => true;

        public override bool SupportFuzzyForwarding => true;

        public override bool StoringTranslationSupported => true;

        public override string PluginID => PluginId;

        public override string FriendlyName => "memoQ AI Hub";

        public override string CopyrightText => "(C) LangLink Localization";

        public override Image DisplayIcon
        {
            get
            {
                return CreateDisplayIconCopy();
            }
        }

        internal static Bitmap CreateDisplayIconCopy()
        {
            if (DisplayIconBitmap.Value == null)
            {
                return null;
            }

            return new Bitmap(DisplayIconBitmap.Value);
        }

        private static Bitmap LoadDisplayIconBitmap()
        {
            try
            {
                using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(IconResourceName))
                {
                    if (stream == null)
                    {
                        return null;
                    }

                    using (var original = new Bitmap(stream))
                    {
                        var detached = new Bitmap(original.Width, original.Height, PixelFormat.Format32bppArgb);
                        using (var graphics = Graphics.FromImage(detached))
                        {
                            graphics.DrawImage(original, 0, 0, original.Width, original.Height);
                        }

                        using (var validationStream = new MemoryStream())
                        {
                            detached.Save(validationStream, ImageFormat.Png);
                        }

                        return detached;
                    }
                }
            }
            catch
            {
                return null;
            }
        }

        public override bool IsLanguagePairSupported(LanguagePairSupportedParams args)
        {
            return MemoQAIHubCapabilityGate.IsLanguagePairSupported(args);
        }

        public override IEngine2 CreateEngine(CreateEngineParams args)
        {
            return new MemoQAIHubEngine(args.SourceLangCode, args.TargetLangCode, new MemoQAIHubOptions(args.PluginSettings));
        }

        public override PluginSettings EditOptions(IWin32Window parentForm, PluginSettings settings)
        {
            using (var form = new MemoQAIHubOptionsForm(new MemoQAIHubOptions(settings)))
            {
                return form.ShowDialog(parentForm) == DialogResult.OK
                    ? form.Options.GetSerializedSettings()
                    : settings;
            }
        }
    }
}
