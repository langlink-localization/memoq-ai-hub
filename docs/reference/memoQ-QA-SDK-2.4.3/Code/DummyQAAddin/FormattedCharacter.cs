namespace DummyQAAddin
{
    class FormattedCharacter : FormattedTextElement
    {
        private readonly char charValue;

        public FormattedCharacter(char charValue, byte flags = 0) : base(flags)
        {
            this.charValue = charValue;
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
            get { return true; }
        }

        public override FormattedCharacter AsCharacter
        {
            get { return this; }
        }

        public char CharValue
        {
            get { return charValue; }
        }

        public static explicit operator char(FormattedCharacter ch)
        {
            return ch.charValue;
        }
    }
}
