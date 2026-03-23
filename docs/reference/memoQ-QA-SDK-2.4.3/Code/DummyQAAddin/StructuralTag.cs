using System;

namespace DummyQAAddin
{
    class StructuralTag : FormattedTextElement
    {
        public StructuralTag(byte flags = 0)
            : base(flags)
        {
        }

        public override bool IsInlineTag
        {
            get { return false; }
        }

        public override bool IsStructuralTag
        {
            get { return true; }
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
