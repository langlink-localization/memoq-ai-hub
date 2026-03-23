using System;

namespace DummyQAAddin
{
    class InlineTag : FormattedTextElement
    {
        private string content;

        public string Content
        {
            get { return content; }
            set { content = value; }
        }

        public InlineTag(string content, byte flags = 0) : base(flags)
        {
            this.content = content;
        }

        public InlineTag()
        {
        }

        public override bool IsInlineTag
        {
            get { return true; }
        }

        public override bool IsStructuralTag
        {
            get { return false; }
        }

        public override bool IsCharacter
        {
            get { return false; }
        }

        public override FormattedCharacter AsCharacter
        {
            get { throw new InvalidOperationException(); }
        }
    }
}
