namespace DummyQAAddin
{
    enum CheckResultType
    {
        Warning = 1,
        Error = 2
    }

    /// <summary>
    /// This class represents an error or warning about a translation.
    /// </summary>
    class TranslationCheckResult
    {
        private readonly Text source;
        private readonly Text target;

        private CheckResultType type;

        private string displayText;
        private string longDescription;
        private int? startingPos, endingPos;
        private int code;
        private string problemName;
        private bool dataSpecific;
        private bool ignorable;

        public TranslationCheckResult(Text source, Text target)
        {
            this.source = source;
            this.target = target;
        }

        public Text Source
        {
            get { return source; }
        }

        public Text Target
        {
            get { return target; }
        }

        /// <summary>
        /// Short description to display. Should not be null or empty.
        /// If <see cref="DataSpecific"/> is true, then this can contain
        /// detailed information what is the problem with the translation
        /// (e.g. wrong term translation, the thing that is missing, etc.)
        /// </summary>
        public string DisplayText
        {
            get { return displayText; }
            set { displayText = value; }
        }

        /// <summary>
        /// Long description. Can be null or empty.
        /// If <see cref="DataSpecific"/> is true, then this can contain
        /// detailed information what is the problem with the translation
        /// (e.g. wrong term translation, the thing that is missing, etc.)
        /// </summary>
        public string LongDescription
        {
            get { return longDescription; }
            set { longDescription = value; }
        }

        /// <summary>
        /// ID of the starting marker in target text.
        /// If null, the range starts at the beginning of text.
        /// </summary>
        public int? StartingPos
        {
            get { return startingPos; }
            set { startingPos = value; }
        }

        /// <summary>
        /// ID of the ending marker in target text.
        /// If null, the range ends at the end of text.
        /// </summary>
        public int? EndingPos
        {
            get { return endingPos; }
            set { endingPos = value; }
        }

        /// <summary>
        /// Code to identify the type of error or warning.
        /// Should be between 0 and 999.
        /// </summary>
        public int Code
        {
            get { return code; }
            set { code = value; }
        }

        /// <summary>
        /// Non-dataspecific description of the problem.
        /// Should be unique to each code. Used to help the user
        /// distinguish the problem codes.
        /// </summary>
        public string ProblemName
        {
            get { return problemName; }
            set { problemName = value; }
        }

        /// <summary>
        /// True, if the <see cref="DisplayText"/> or <see cref="LongDescription"/>
        /// contains detailed information about the error or warning, not just
        /// general description.
        /// </summary>
        public bool DataSpecific
        {
            get { return dataSpecific; }
            set { dataSpecific = value; }
        }

        /// <summary>
        /// Warning or Error
        /// </summary>
        public CheckResultType Type
        {
            get { return type; }
            set { type = value; }
        }

        /// <summary>
        /// True if the user can ignore this QA result.
        /// If false then the document cannot be exported.
        /// Can be true only for warnings, errors can never be ignored.
        /// </summary>
        public bool Ignorable
        {
            get { return ignorable; }
            set { ignorable = value; }
        }
    }
}
