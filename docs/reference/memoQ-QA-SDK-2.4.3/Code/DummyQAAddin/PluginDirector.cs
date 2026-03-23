using System.Drawing;
using System.Reflection;
using System.Windows.Forms;
using MemoQ.Addins.Common.Framework;
using MemoQ.QAInterfaces;

namespace DummyQAAddin
{
    public class PluginDirector : MemoQ.QAInterfaces.PluginDirector, IModule
    {
        // obtain this from Kilgray
        internal const int GeneratorId = 23;

        public override Image DisplayIcon
        {
            get
            {
                Assembly assembly = Assembly.GetExecutingAssembly();
                string filename = "DummyQAAddin.icon.bmp";
                return Image.FromStream(assembly.GetManifestResourceStream(filename));
            }
        }

        public override string FriendlyName
        {
            get { return "Dummy QA Addin"; }
        }

        public override string PluginID
        {
            get { return "DummyQAAddin"; }
        }

        public override int GeneratorID
        {
            get { return GeneratorId; }
        }

        public override string CopyrightText
        {
            get { return "NonSense Technologies"; }
        }

        public override bool BatchQACheckSupported
        {
            get { return true; }
        }

        public override IBatchQAChecker CreateBatchQAChecker()
        {
            return new BatchQAChecker();
        }

        public override bool SegmentLevelQACheckSupported
        {
            get { return true; }
        }

        public override ISegmentLevelQAChecker CreateSegmentLevelQAChecker()
        {
            return new SegmentLevelQAChecker();
        }

        public override void ShowOptionsForm(Form parentForm)
        {
            MessageBox.Show(parentForm, "I  just came to say hello", "Saying hello", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        public override string[] SupportedBatchFormats
        {
            get
            {
                return new string[] { ExportFormats.MqXliff };
            }
        }

        public override string[] SupportedSegmentLevelFormats
        {
            get
            {
                return new string[] { ExportFormats.MqXliff };
            }
        }

        public override IEnvironment Environment
        {
            set
            {
                // TO-DO implement this if environment specific information (UI language) is needed
            }
        }

        #region IModule implementation

        public bool IsActivated
        {
            get { return true; }
        }

        public void Initialize(IModuleEnvironment env)
        {

        }

        public void Cleanup()
        {

        }

        #endregion

    }
}
