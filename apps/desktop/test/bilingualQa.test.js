'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseBilingualContent } = require('../src/bilingual/bilingualFile');
const { flattenResults, writeQaReports } = require('../src/bilingual/qaReport');

test('parses XLIFF 1.2 and XLIFF 2 segments without writing the source file', () => {
  const one = parseBilingualContent('<xliff source-language="en" target-language="zh"><file><body><trans-unit id="1"><source>Hello <ph id="1"/></source><target>你好 <ph id="1"/></target></trans-unit></body></file></xliff>', { fileName: 'a.mqxliff' });
  assert.equal(one.languages.source, 'en');
  assert.equal(one.segments.length, 1);
  assert.match(one.segments[0].source, /<ph id="1"\/>/);
  const two = parseBilingualContent('<xliff version="2.0" srcLang="en" trgLang="de"><file id="f"><unit id="u"><segment id="s"><source>A</source><target>B</target></segment></unit></file></xliff>', { fileName: 'b.xlf' });
  assert.equal(two.segments[0].id, 's');
});

test('HTML, CSV, and JSON reports contain the same finding count', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-qa-report-'));
  const result = { document: { id: 'd', name: 'doc' }, results: [{ document: { id: 'd', name: 'doc' }, segment: { segmentIndex: 0 }, findings: [{ id: 'f', category: 'formatting', severity: 'minor', title: '<Issue>', message: 'M', sourceEvidence: 'A', targetEvidence: 'B', suggestedTranslation: 'C', confidence: 1, origin: 'deterministic' }] }] };
  const reports = writeQaReports(result, directory, 'report');
  assert.equal(reports.findingCount, flattenResults(result).length);
  assert.equal(JSON.parse(fs.readFileSync(reports.jsonPath, 'utf8')).results[0].findings.length, 1);
  assert.equal(fs.readFileSync(reports.csvPath, 'utf8').trim().split(/\r?\n/).length - 1, 1);
  assert.match(fs.readFileSync(reports.htmlPath, 'utf8'), /&lt;Issue&gt;/);
});
