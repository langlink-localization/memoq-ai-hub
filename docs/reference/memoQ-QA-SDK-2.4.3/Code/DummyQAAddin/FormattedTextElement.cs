namespace DummyQAAddin
{
    abstract class FormattedTextElement
    {
        public const byte FORMAT_BOLD_FLAG = 1;
        public const byte FORMAT_ITALIC_FLAG = 2;
        public const byte FORMAT_UNDERLINE_FLAG = 4;
        public const byte FORMAT_SUBSCRIPT_FLAG = 8;
        public const byte FORMAT_SUPERSCRIPT_FLAG = 16;

        private readonly byte flags;

        protected FormattedTextElement(byte flags = 0)
        {
            this.flags = flags;
        }

        public bool IsBold
        {
            get { return (flags & FORMAT_BOLD_FLAG) != 0; }
        }

        public bool IsItalic
        {
            get { return (flags & FORMAT_ITALIC_FLAG) != 0; }
        }

        public bool IsUnderline
        {
            get { return (flags & FORMAT_UNDERLINE_FLAG) != 0; }
        }

        public bool IsSubscript
        {
            get { return (flags & FORMAT_SUBSCRIPT_FLAG) != 0; }
        }

        public bool IsSuperscript
        {
            get { return (flags & FORMAT_SUPERSCRIPT_FLAG) != 0; }
        }

        public abstract bool IsInlineTag { get; }

        public abstract bool IsStructuralTag { get; }

        public abstract bool IsCharacter { get; }

        public abstract FormattedCharacter AsCharacter { get; }
    }
}
