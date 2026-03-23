using System;
using System.Text;
using System.Xml;

namespace DummyQAAddin
{
    static class XmlExtensions
    {
        public static string ReadInnerAsString(this XmlReader reader)
        {
            if (reader == null)
                throw new ArgumentNullException("reader");

            // reader should be positioned on the element whose content is needed
            if (reader.NodeType != XmlNodeType.Element)
                throw new ArgumentException("Reader is not placed on an element", "rdr");

            if (reader.IsEmptyElement)
                return "";

            string nodeName = reader.Name;

            StringBuilder result = new StringBuilder();
            var ws = new XmlWriterSettings();
            ws.OmitXmlDeclaration = true;
            ws.ConformanceLevel = ConformanceLevel.Fragment;

            using (XmlWriter wrt = XmlWriter.Create(result, ws))
            {
                while (reader.Read() && !(reader.NodeType == XmlNodeType.EndElement && reader.Name == nodeName))
                {
                    switch (reader.NodeType)
                    {
                        case XmlNodeType.Element:
                            wrt.WriteStartElement(reader.LocalName);
                            wrt.WriteAttributes(reader, true);
                            if (reader.IsEmptyElement)
                                wrt.WriteEndElement();
                            break;
                        case XmlNodeType.SignificantWhitespace:
                        case XmlNodeType.Whitespace:
                            wrt.WriteWhitespace(reader.Value);
                            break;
                        case XmlNodeType.Text:
                            wrt.WriteString(reader.Value);
                            break;
                        case XmlNodeType.EndElement:
                            wrt.WriteFullEndElement();
                            break;
                    }
                }
            }

            // skip the parent end element
            reader.Read();

            return result.ToString();
        }

        public static void EatWhitespace(this XmlReader reader)
        {
            while (reader.NodeType == XmlNodeType.Whitespace
                   || reader.NodeType == XmlNodeType.SignificantWhitespace)
                reader.Read();
        }

        public static void ShallowCopyNodeTo(this XmlReader reader, XmlWriter writer)
        {
            if (reader == null)
            {
                throw new ArgumentNullException("reader");
            }
            if (writer == null)
            {
                throw new ArgumentNullException("writer");
            }

            switch (reader.NodeType)
            {
                case XmlNodeType.Element:
                    writer.WriteStartElement(reader.Prefix, reader.LocalName, reader.NamespaceURI);
                    writer.WriteAttributes(reader, true);
                    if (reader.IsEmptyElement)
                        writer.WriteEndElement();
                    break;
                case XmlNodeType.Text:
                    writer.WriteString(reader.Value);
                    break;
                case XmlNodeType.Whitespace:
                case XmlNodeType.SignificantWhitespace:
                    writer.WriteWhitespace(reader.Value);
                    break;
                case XmlNodeType.CDATA:
                    writer.WriteCData(reader.Value);
                    break;
                case XmlNodeType.EntityReference:
                    writer.WriteEntityRef(reader.Name);
                    break;
                case XmlNodeType.XmlDeclaration:
                case XmlNodeType.ProcessingInstruction:
                    writer.WriteProcessingInstruction(reader.Name, reader.Value);
                    break;
                case XmlNodeType.DocumentType:
                    writer.WriteDocType(reader.Name, reader.GetAttribute("PUBLIC"), reader.GetAttribute("SYSTEM"), reader.Value);
                    break;
                case XmlNodeType.Comment:
                    writer.WriteComment(reader.Value);
                    break;
                case XmlNodeType.EndElement:
                    writer.WriteFullEndElement();
                    break;
            }
        }

        public static void ShallowCopyNodeFrom(this XmlWriter writer, XmlReader reader)
        {
            if (reader == null)
            {
                throw new ArgumentNullException("reader");
            }
            if (writer == null)
            {
                throw new ArgumentNullException("writer");
            }

            switch (reader.NodeType)
            {
                case XmlNodeType.Element:
                    writer.WriteStartElement(reader.Prefix, reader.LocalName, reader.NamespaceURI);
                    writer.WriteAttributes(reader, true);
                    if (reader.IsEmptyElement)
                        writer.WriteEndElement();
                    break;
                case XmlNodeType.Text:
                    writer.WriteString(reader.Value);
                    break;
                case XmlNodeType.Whitespace:
                case XmlNodeType.SignificantWhitespace:
                    writer.WriteWhitespace(reader.Value);
                    break;
                case XmlNodeType.CDATA:
                    writer.WriteCData(reader.Value);
                    break;
                case XmlNodeType.EntityReference:
                    writer.WriteEntityRef(reader.Name);
                    break;
                case XmlNodeType.XmlDeclaration:
                case XmlNodeType.ProcessingInstruction:
                    writer.WriteProcessingInstruction(reader.Name, reader.Value);
                    break;
                case XmlNodeType.DocumentType:
                    writer.WriteDocType(reader.Name, reader.GetAttribute("PUBLIC"), reader.GetAttribute("SYSTEM"), reader.Value);
                    break;
                case XmlNodeType.Comment:
                    writer.WriteComment(reader.Value);
                    break;
                case XmlNodeType.EndElement:
                    writer.WriteFullEndElement();
                    break;
            }
        }
    }
}
