'use strict';

const path = require('path');

// Import QA stays behind this owner so the composition root does not parse
// bilingual files or choose report filenames.
/**
 * @param {{
 *   qaService: { checkDocument: (payload: Record<string, any>) => Promise<any> | any },
 *   exportsDir: string,
 *   parseBilingualFile?: (filePath: string) => { document: { name: string }, languages: any, segments: any },
 *   writeQaReports?: (result: any, exportsDir: string, reportName: string) => any,
 *   now?: () => number
 * }} dependencies
 */
function createRuntimeBilingualInspection({
  qaService,
  exportsDir,
  parseBilingualFile = (/** @type {string} */ filePath) => require('../bilingual/bilingualFile').parseBilingualFile(filePath),
  writeQaReports = (/** @type {any} */ result, /** @type {string} */ reportDir, /** @type {string} */ reportName) => require('../bilingual/qaReport').writeQaReports(result, reportDir, reportName),
  now = Date.now
}) {
  if (!exportsDir) {
    throw new TypeError('Bilingual inspection exports directory is required.');
  }

  /**
   * @param {Record<string, any>=} payload
   */
  async function inspectBilingualFile(payload = {}) {
    const imported = parseBilingualFile(payload.filePath);
    const result = await qaService.checkDocument({
      trigger: 'import',
      ...payload,
      document: imported.document,
      languages: imported.languages,
      segments: imported.segments
    });
    const reports = writeQaReports(result, exportsDir, `qa-${path.parse(imported.document.name).name}-${now()}`);
    return { imported, result, reports, containsCustomerText: true };
  }

  return { inspectBilingualFile };
}

module.exports = {
  createRuntimeBilingualInspection
};
