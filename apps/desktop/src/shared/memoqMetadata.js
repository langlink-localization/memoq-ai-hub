const MEMOQ_METADATA_FIELDS = [
  { ruleKey: 'client', metadataKey: 'client', matcher: 'equals', inputLabelKey: 'context.matchClient' },
  { ruleKey: 'domain', metadataKey: 'domain', matcher: 'includes', inputLabelKey: 'context.matchDomain' },
  { ruleKey: 'subjectContains', metadataKey: 'subject', matcher: 'includes', inputLabelKey: 'context.matchSubject' },
  { ruleKey: 'projectId', metadataKey: 'projectId', matcher: 'equals', inputLabelKey: 'context.matchProjectId' },
  { ruleKey: 'sourceLanguage', metadataKey: 'sourceLanguage', matcher: 'equals', inputLabelKey: 'context.matchSourceLanguage' },
  { ruleKey: 'targetLanguage', metadataKey: 'targetLanguage', matcher: 'equals', inputLabelKey: 'context.matchTargetLanguage' },
  { ruleKey: 'documentIdRegex', metadataKey: 'documentId', matcher: 'regex', inputLabelKey: 'context.matchDocumentId' },
  { ruleKey: 'segmentStatus', metadataKey: 'segmentStatus', matcher: 'equals', inputLabelKey: 'mapping.segmentStatus' }
];

function createDefaultMetadataMatchInput() {
  return {
    client: '',
    domain: '',
    subject: '',
    projectId: '',
    documentId: '',
    sourceLanguage: 'EN',
    targetLanguage: 'ZH',
    segmentStatus: ''
  };
}

function summarizeRuleConditions(rule = {}) {
  return MEMOQ_METADATA_FIELDS
    .map((field) => String(rule[field.ruleKey] || '').trim())
    .filter(Boolean)
    .join(' / ') || '*';
}

module.exports = {
  MEMOQ_METADATA_FIELDS,
  createDefaultMetadataMatchInput,
  summarizeRuleConditions
};
