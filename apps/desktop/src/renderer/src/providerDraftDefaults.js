function getProviderDraftSeed(type) {
  const normalizedType = String(type || '').trim().toLowerCase();
  if (normalizedType === 'openai-compatible') {
    return {
      name: 'OpenAI Compatible',
      type: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      requestPath: '/chat/completions',
      modelNames: []
    };
  }

  return {
    name: 'OpenAI',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    requestPath: '/responses',
    modelNames: ['gpt-5.4-mini']
  };
}

module.exports = {
  getProviderDraftSeed
};
