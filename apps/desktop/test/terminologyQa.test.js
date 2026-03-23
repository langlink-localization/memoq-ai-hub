const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateTerminologyQa } = require('../src/asset/assetTerminology');

test('terminology QA reports missing required terms and forbidden variants without blocking', () => {
  const result = evaluateTerminologyQa({
    sourceText: 'Open the workspace and sign in.',
    translatedText: 'Ouvrez espace de travail et se connecter.',
    matches: [
      {
        entry: {
          sourceTerm: 'workspace',
          targetTerm: 'zone client',
          forbidden: false,
          allowedVariants: ['Zone client']
        }
      },
      {
        entry: {
          sourceTerm: 'sign in',
          targetTerm: 'se connecter',
          forbidden: true,
          allowedVariants: []
        }
      }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocking, false);
  assert.equal(result.issues.length, 2);
  assert.match(result.issues[0].message, /workspace/i);
  assert.match(result.issues[1].message, /sign in/i);
});
