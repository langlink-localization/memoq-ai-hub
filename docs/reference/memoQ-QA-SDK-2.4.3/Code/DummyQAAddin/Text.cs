using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Xml;

namespace DummyQAAddin
{
    /// <summary>
    /// This class represents a piece of text from either side of a translation.
    /// Contains formatted characters, inline tags and structurals tags.
    /// </summary>
    class Text : IEnumerable<FormattedTextElement>
    {
        private List<FormattedTextElement> elements = new List<FormattedTextElement>();

        private InlineTag[] iTags;

        private StructuralTag[] sTags;

        // (position; id) pairs
        private Dictionary<int, int> markers = new Dictionary<int, int>();
        private int markerCount = 0;

        /// <summary>
        /// Creates a new instance of this class from xliff representation.
        /// </summary>
        /// <param name="xliffRepresentation">
        /// Xliff format of source or target text. Should NOT include
        /// starting and ending source or target tags, should only contain
        /// the content of these tags.</param>
        public Text(string xliffRepresentation)
        {
            processXliff(xliffRepresentation);
        }

        /// <summary>
        /// Returns the xliff representation of this text, which can be inserted
        /// into a target tag. New markers are included.
        /// </summary>
        public string GetXliffRepresentation()
        {
            StringBuilder sb = new StringBuilder();

            using (var writer = new XmlTextWriter(new StringWriter(sb)))
            {
                // the formattings
                bool b = false; bool i = false; bool u = false; bool sub = false; bool sup = false;
                // the indicators for closing and opening character formats
                bool cb, ob, ci, oi, cu, ou, csub, osub, csup, osup;

                // the next id that can be written into a formatting bpt tag.
                int nextformatid = 1;
                // the ids of the formattings respectively, if zero, the formating is not opened
                int bid = 0; int iid = 0; int uid = 0; int subid = 0; int supid = 0;

                for (int j = 0; j < elements.Count; j++)
                {
                    FormattedTextElement e = elements[j];

                    // place the marker _before_ the position you want to mark
                    // so if you want a marker at the beginning, place the marker first
                    // if you want on the last position, place before the last element, etc.
                    int mid;
                    if (markers.TryGetValue(j, out mid))
                        writeMarker(writer, mid);

                    // see if formatting is changed between this character and the previous situation
                    examineFormatChange(b, i, u, sub, sup, e, out cb, out ob, out ci, out oi, out cu, out ou, out csub, out osub, out csup, out osup);

                    // close formattings that need to be closed
                    closeFormatting(ref b, cb, ref bid, writer);
                    closeFormatting(ref i, ci, ref iid, writer);
                    closeFormatting(ref u, cu, ref uid, writer);
                    closeFormatting(ref sub, csub, ref subid, writer);
                    closeFormatting(ref sup, csup, ref supid, writer);

                    // open formattings that need to be opened
                    openFormatting(ref b, ob, "bold", ref bid, ref nextformatid, writer);
                    openFormatting(ref i, oi, "italic", ref iid, ref nextformatid, writer);
                    openFormatting(ref u, ou, "underlined", ref uid, ref nextformatid, writer);
                    openFormatting(ref sub, osub, "x-sub", ref subid, ref nextformatid, writer);
                    openFormatting(ref sup, osup, "x-sup", ref supid, ref nextformatid, writer);

                    if (e.IsCharacter)
                    {
                        writer.WriteString(e.AsCharacter.CharValue.ToString());
                    }
                    else if (e.IsStructuralTag)
                    {
                        writeStructuralTag(writer, e as StructuralTag);
                    }
                    else if (e.IsInlineTag)
                    {
                        writeInlineTag(writer, e as InlineTag);
                    }
                }

                // close opened formattings
                closeFormatting(ref b, b, ref bid, writer);
                closeFormatting(ref i, i, ref iid, writer);
                closeFormatting(ref u, u, ref uid, writer);
                closeFormatting(ref sub, sub, ref subid, writer);
                closeFormatting(ref sup, sup, ref supid, writer);
            }

            return sb.ToString();
        }

        // returns the id of the marker
        public int AddMarker(int pos)
        {
            if (pos < 0 || pos >= elements.Count)
                throw new IndexOutOfRangeException();

            int id;

            if (markers.TryGetValue(pos, out id))
                return id;

            id = ++markerCount;
            markers.Add(pos, id);
            return id;
        }

        public int Length
        {
            get { return elements.Count; }
        }

        public InlineTag[] InlineTags
        {
            get { return iTags; }
        }

        public StructuralTag[] StructuralTags
        {
            get { return sTags; }
        }

        public FormattedTextElement this[int index]
        {
            get { return elements[index]; }
        }

        #region IEnumerable

        public IEnumerator<FormattedTextElement> GetEnumerator()
        {
            return elements.GetEnumerator();
        }

        IEnumerator IEnumerable.GetEnumerator()
        {
            return GetEnumerator();
        }

        #endregion

        private void processXliff(string xliff)
        {
            // to be able to use XmlReader, we wrap the xliff content inside a tag
            xliff = string.Format("<mns:text xmlns:mns=\"MemoQ-QAText\" xml:space=\"preserve\">{0}</mns:text>", xliff);

            bool b, i, u, sub, sup;
            b = i = u = sub = sup = false;

            var inlineTags = new List<InlineTag>();
            var structuralTags = new List<StructuralTag>();

            using (XmlReader rdr = XmlReader.Create(new StringReader(xliff)))
            {
                // text element
                rdr.Read();

                // element after <text>
                rdr.Read();

                // bpt/ept id -> format type pairs
                Dictionary<int, string> formatting = new Dictionary<int, string>();

                // read until closing element
                while (!(rdr.NodeType == XmlNodeType.EndElement &&
                       rdr.LocalName == "text" &&
                       rdr.NamespaceURI == "MemoQ-QAText"))
                {
                    switch (rdr.NodeType)
                    {
                        case XmlNodeType.Element:
                            if (rdr.LocalName == "ph")
                            {
                                StringBuilder content = new StringBuilder(rdr.ReadElementContentAsString());
                                // escape special xml characters,
                                // because xml reader escapes it back
                                content.Replace("&", "&amp;");
                                content.Replace("<", "&lt;");
                                content.Replace(">", "&gt;");
                                content.Replace("\"", "&quot;");
                                content.Replace("'", "&apos;");

                                // inline tag
                                var itag = new InlineTag(content.ToString(),
                                                         toFlagBytes(b, i, u, sub, sup));

                                inlineTags.Add(itag);
                                elements.Add(itag);
                            }
                            else if (rdr.LocalName == "x")
                            {
                                // structural tag
                                var stag = new StructuralTag(toFlagBytes(b, i, u, sub, sup));

                                structuralTags.Add(stag);
                                elements.Add(stag);
                                rdr.Read();
                            }
                            else if (rdr.LocalName == "bpt")
                            {
                                // begin of formatting
                                int id = int.Parse(rdr.GetAttribute("id"));
                                string type = rdr.GetAttribute("ctype");

                                switch (type)
                                {
                                    case "bold":
                                        b = true;
                                        break;
                                    case "italic":
                                        i = true;
                                        break;
                                    case "underlined":
                                        u = true;
                                        break;
                                    case "x-sub":
                                        sub = true;
                                        break;
                                    case "x-sup":
                                        sup = true;
                                        break;
                                }

                                formatting.Add(id, type);

                                rdr.Read();
                            }
                            else if (rdr.LocalName == "ept")
                            {
                                // end of formatting
                                int id = int.Parse(rdr.GetAttribute("id"));
                                string type = formatting[id];
                                switch (type)
                                {
                                    case "bold":
                                        b = false;
                                        break;
                                    case "italic":
                                        i = false;
                                        break;
                                    case "underlined":
                                        u = false;
                                        break;
                                    case "x-sub":
                                        sub = false;
                                        break;
                                    case "x-sup":
                                        sup = false;
                                        break;
                                }
                                formatting.Remove(id);

                                rdr.Read();
                            }
                            else
                            {
                                // some other tag
                                rdr.Read();
                            }
                            break;
                        case XmlNodeType.Text:
                        case XmlNodeType.Whitespace:
                        case XmlNodeType.SignificantWhitespace:
                            addString(rdr.Value, toFlagBytes(b, i, u, sub, sup));
                            rdr.Read();
                            break;
                    }
                }

                // read past closing element
                rdr.Read();
            }

            iTags = inlineTags.ToArray();
            sTags = structuralTags.ToArray();
        }

        private void addString(string str, byte flags)
        {
            foreach (char c in str)
                elements.Add(new FormattedCharacter(c, flags));
        }

        private byte toFlagBytes(bool b, bool i, bool u, bool sub, bool sup)
        {
            byte result = 0;

            if (b)
                result |= FormattedTextElement.FORMAT_BOLD_FLAG;

            if (i)
                result |= FormattedTextElement.FORMAT_ITALIC_FLAG;

            if (u)
                result |= FormattedTextElement.FORMAT_UNDERLINE_FLAG;

            if (sub)
                result |= FormattedTextElement.FORMAT_SUBSCRIPT_FLAG;

            if (sup)
                result |= FormattedTextElement.FORMAT_SUPERSCRIPT_FLAG;

            return result;
        }

        private void writeMarker(XmlWriter writer, int id)
        {
            writer.WriteStartElement("mrk");
            writer.WriteAttributeString("mtype", "x-ewloc");
            writer.WriteAttributeString("mid", id.ToString());
            writer.WriteEndElement();
        }

        private void writeInlineTag(XmlWriter writer, InlineTag iTag)
        {
            writer.WriteStartElement("ph");
            writer.WriteRaw(iTag.Content);
            writer.WriteFullEndElement();
        }

        private void writeStructuralTag(XmlWriter writer, StructuralTag sTag)
        {
            writer.WriteStartElement("x");
            writer.WriteEndElement();
        }

        /// <summary>
        /// Gets the actions what nedds to be done with formatting before writing the given character.
        /// </summary>
        private static void examineFormatChange(bool b, bool i, bool u, bool sub, bool sup, FormattedTextElement fc, out bool cb, out bool ob, out bool ci, out bool oi, out bool cu, out bool ou, out bool csub, out bool osub, out bool csup, out bool osup)
        {
            examineFormatChange(b, fc.IsBold, out cb, out ob);
            examineFormatChange(i, fc.IsItalic, out ci, out oi);
            examineFormatChange(u, fc.IsUnderline, out cu, out ou);
            examineFormatChange(sub, fc.IsSubscript, out csub, out osub);
            examineFormatChange(sup, fc.IsSuperscript, out csup, out osup);
        }

        /// <summary>
        /// Gets if formatting needs to be opened or closed.
        /// </summary>
        /// <param name="f">The state of the current format.</param>
        /// <param name="nf">The state of the new format.</param>
        /// <param name="cf">True, if the formatting needs to be closed.</param>
        /// <param name="of">True, if the formatting needs to be opened. </param>
        private static void examineFormatChange(bool f, bool nf, out bool cf, out bool of)
        {
            cf = (f && !nf);
            of = (!f && nf);
        }

        private static void openFormatting(ref bool f, bool of, string fname, ref int fid, ref int nextformatid, XmlWriter writer)
        {
            if (of)
            {

                writer.WriteStartElement("bpt");
                writer.WriteAttributeString("id", nextformatid.ToString());
                fid = nextformatid;
                // a formatting is opened, the next one uses another id
                ++nextformatid;

                writer.WriteAttributeString("ctype", fname);
                writer.WriteEndElement();

                f = true;
            }
        }

        private static void closeFormatting(ref bool f, bool cf, ref int fid, XmlWriter writer)
        {
            if (cf)
            {
                if (fid <= 0)
                    throw new Exception("There should be an id for the format that is being closed");

                closeFormattingWithId(fid, writer);
                f = false;
                fid = 0;
            }
        }

        private static void closeFormattingWithId(int id, XmlWriter writer)
        {
            writer.WriteStartElement("ept");
            writer.WriteAttributeString("id", id.ToString());
            writer.WriteEndElement();
        }
    }
}
