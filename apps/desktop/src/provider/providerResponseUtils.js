function normalizeRequestType(requestType) {
  const token = String(requestType || '').trim().replace(/[\s_-]+/g, '').toLowerCase();
  if (!token || token === 'plaintext') {
    return 'Plaintext';
  }
  if (token === 'html' || token === 'onlyformatting') {
    return 'OnlyFormatting';
  }
  if (token === 'xml' || token === 'bothformatting' || token === 'bothformattingandtags') {
    return 'BothFormattingAndTags';
  }
  return 'Plaintext';
}

function stripCodeFences(text) {
  return String(text || '').trim().replace(/^```(?:[a-z]+)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function normalizeTranslatedText(text, requestType) {
  let normalized = stripCodeFences(text);

  if (normalizeRequestType(requestType) === 'Plaintext') {
    normalized = normalized
      .replace(/<\/?[^>]+>/g, ' ')
      .replace(/\s+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  return normalized;
}

function normalizeRetryAfterSeconds(value, message = '') {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 0) {
      return numeric;
    }
  }

  const normalizedMessage = String(message || '').toLowerCase();
  const retryAfterMatch = normalizedMessage.match(/retry[-\s]?after[^0-9]*(\d+(?:\.\d+)?)/i);
  if (!retryAfterMatch) {
    return null;
  }

  const seconds = Number(retryAfterMatch[1]);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function mapProviderError(error) {
  const message = String(error?.message || error || 'Unknown provider error');
  const lower = message.toLowerCase();
  const retryAfterSeconds = normalizeRetryAfterSeconds(error?.retryAfterSeconds, message);
  if (lower.includes('bytestring') || lower.includes('replacement character') || lower.includes('u+fffd')) {
    return { code: 'PROVIDER_CONFIG_INVALID', message, retryAfterSeconds };
  }
  if (lower.includes('api key') || lower.includes('unauthorized') || lower.includes('401') || lower.includes('403')) {
    return { code: 'PROVIDER_AUTH_FAILED', message, retryAfterSeconds };
  }
  if (
    lower.includes('429')
    || lower.includes('rate limit')
    || lower.includes('ratelimit')
    || lower.includes('too many requests')
    || lower.includes('retry after')
  ) {
    return { code: 'PROVIDER_RATE_LIMITED', message, retryAfterSeconds };
  }
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('abort')) {
    return { code: 'PROVIDER_TIMEOUT', message, retryAfterSeconds };
  }
  if (lower.includes('network') || lower.includes('fetch failed') || lower.includes('enotfound') || lower.includes('econnrefused')) {
    return { code: 'PROVIDER_NETWORK_FAILED', message, retryAfterSeconds };
  }
  return { code: 'PROVIDER_REQUEST_FAILED', message, retryAfterSeconds };
}

function extractResponseText(response) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const outputItems = Array.isArray(response?.output) ? response.output : [];
  const textParts = [];

  for (const item of outputItems) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === 'string' && part.text.trim()) {
        textParts.push(part.text.trim());
      }

      const values = Object.values(part || {});
      for (const value of values) {
        // Some providers nest refusal/safety payloads as plain objects inside a content part.
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          try {
            return JSON.stringify(value);
          } catch {
          }
        }
      }
    }
  }

  return textParts.join('\n').trim();
}

function extractChatText(completion) {
  const content = completion?.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => (typeof item?.text === 'string' ? item.text : ''))
      .join('\n')
      .trim();
  }
  return '';
}

function extractJsonText(text) {
  const normalized = stripCodeFences(text);
  const trimmed = normalized.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed;
  }
  const firstObject = normalized.indexOf('{');
  const lastObject = normalized.lastIndexOf('}');

  if (firstObject >= 0 && lastObject > firstObject) {
    return normalized.slice(firstObject, lastObject + 1);
  }

  return normalized;
}

function parseBatchTranslations(input, requestType, expectedIndexes = []) {
  let payload = input;
  if (typeof input === 'string') {
    try {
      payload = JSON.parse(extractJsonText(input));
    } catch (error) {
      throw new Error(`Batch translation response is not valid JSON. Expected either [{"index":0,"text":"..."}] or {"translations":[{"index":0,"text":"..."}]}. ${error.message}`);
    }
  }

  const items = Array.isArray(payload)
    ? payload
    : (Array.isArray(payload?.translations) ? payload.translations : []);

  if (!items.length && expectedIndexes.length) {
    throw new Error('Batch translation response did not include valid translations. Expected either [{"index":0,"text":"..."}] or {"translations":[{"index":0,"text":"..."}]}.');
  }

  const expected = new Set(expectedIndexes.map((value) => Number(value)));
  const seen = new Set();

  const translations = items.map((item) => {
    const index = Number(item?.index);
    if (!Number.isFinite(index)) {
      throw new Error('Batch translation response contains an invalid index.');
    }
    if (!expected.has(index)) {
      throw new Error(`Batch translation response index ${index} was not requested.`);
    }
    if (seen.has(index)) {
      throw new Error(`Batch translation response contains duplicate index ${index}.`);
    }
    seen.add(index);
    return {
      index,
      text: normalizeTranslatedText(item?.text || '', requestType)
    };
  });

  if (seen.size !== expected.size) {
    throw new Error(`Batch translation response returned ${seen.size} item(s); expected ${expected.size}.`);
  }

  return translations.sort((left, right) => left.index - right.index);
}

function parseSingleTranslation(input, requestType) {
  let payload = input;
  if (typeof input === 'string') {
    try {
      payload = JSON.parse(extractJsonText(input));
    } catch (error) {
      throw new Error(`Single translation response is not valid JSON: ${error.message}`);
    }
  }

  const translationItem = Array.isArray(payload?.translations) ? payload.translations[0] : null;
  const text = typeof payload?.translation === 'string'
    ? payload.translation
    : (typeof payload?.text === 'string'
      ? payload.text
      : (typeof translationItem?.text === 'string' ? translationItem.text : ''));

  if (!text.trim()) {
    throw new Error('Single translation response did not include a translation string.');
  }

  return normalizeTranslatedText(text, requestType);
}

module.exports = {
  extractChatText,
  extractJsonText,
  extractResponseText,
  mapProviderError,
  normalizeRequestType,
  normalizeTranslatedText,
  parseBatchTranslations,
  parseSingleTranslation,
  stripCodeFences
};
