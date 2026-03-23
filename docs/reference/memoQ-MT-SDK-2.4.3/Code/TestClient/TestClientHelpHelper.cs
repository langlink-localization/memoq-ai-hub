using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;

namespace TestClient
{
    class TestClientHelpHelper : Kilgray.Utils.HelpHelperService
    {
        //constructor for Init.
        public TestClientHelpHelper()
        {
            
        }

        //needed to initialize the HelpHelperService for kilgray utils calls.
        static TestClientHelpHelper()
        {
            Initialize(new TestClientHelpHelper(), 9, 5, Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location), "en");
        } 

        public static void TestClientShowHelp(string page)
        {
            Kilgray.Utils.HelpHelperService.ShowHelp(page);
        }

        //show English web help.
        protected override void showHelp(string page)
        {
            string language =  "en";
            string url = GetWebHelpUrl(language, page, DefaultTopic);

            Process.Start(url);
        }
    }
}
