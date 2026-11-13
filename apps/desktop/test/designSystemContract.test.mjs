import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('..', import.meta.url);
const renderer = new URL('src/renderer/src/', root);

function sourceFiles(directory) {
  return readdirSync(directory, { recursive: true })
    .map(String)
    .filter((path) => /\.(?:css|jsx?|tsx?)$/.test(path))
    .map((path) => ({ path, content: readFileSync(new URL(path, directory), 'utf8') }));
}

test('renderer uses current SizeType and typography roles', () => {
  for (const { path, content } of sourceFiles(renderer)) {
    assert.doesNotMatch(content, /\bsize="middle"/, path);
    assert.doesNotMatch(content, /\bfont-weight:\s*(?:500|700)\b/, path);
    assert.doesNotMatch(content, /\bfontWeight:\s*(?:500|700)\b/, path);
  }
});
