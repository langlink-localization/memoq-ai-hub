using System;
using System.ServiceModel;
using DummyMTInterface;

namespace DummyMTServiceWCF
{
    class Program
    {
        static void Main(string[] args)
        {
            var baseAddress = new Uri("net.tcp://localhost:8733/MTService");

            using (var selfHost = new ServiceHost(typeof(MTService), baseAddress))
            {
                selfHost.AddServiceEndpoint(typeof(IMTService), new NetTcpBinding(), "DummyService");
                selfHost.Open();

                Console.WriteLine("Dummy WCF service is loaded on address "+ selfHost.Description.Endpoints[0].Address +". Press ENTER to exit.");
                Console.ReadLine();
            }
        }
    }
}
