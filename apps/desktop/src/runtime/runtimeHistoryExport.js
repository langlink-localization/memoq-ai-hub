'use strict';

const fs = require('fs');
const path = require('path');

const {
  filterHistoryEntries,
  formatLocalTimestamp
} = require('./runtimeHistory');

// Spreadsheet export is a filesystem side effect. History list projection
// stays in runtimeHistoryPresentation and does not load xlsx.
/**
 * @param {{
 *   loadHistoryEntries: () => any[],
 *   exportsDir: string,
 *   loadXlsx?: () => any,
 *   now?: () => number
 * }} dependencies
 */
function createRuntimeHistoryExport({
  loadHistoryEntries,
  exportsDir,
  loadXlsx = () => require('xlsx'),
  now = Date.now
}) {
  if (!exportsDir) {
    throw new TypeError('History export directory is required.');
  }

  /**
   * @param {Record<string, any>=} options
   */
  function exportHistory(options = {}) {
    const XLSX = loadXlsx();
    const entriesSource = loadHistoryEntries();
    const entries = options.scope === 'selected'
      ? entriesSource.filter((/** @type {any} */ item) => (options.selectedIds || []).includes(item.id))
      : filterHistoryEntries(entriesSource, options.filters || {});
    const rows = entries.flatMap((/** @type {any} */ entry) => entry.segments.map((/** @type {any} */ segment) => ({
      requestId: entry.requestId,
      projectId: entry.projectId,
      client: entry.client,
      domain: entry.domain,
      subject: entry.subject,
      documentId: entry.documentId,
      projectGuid: entry.projectGuid,
      profile: entry.profileName,
      provider: entry.providerName,
      model: entry.model,
      submittedAt: formatLocalTimestamp(entry.submittedAt),
      completedAt: formatLocalTimestamp(entry.completedAt),
      source: segment.sourceText,
      target: segment.targetText,
      tmSource: segment.tmSource,
      tmTarget: segment.tmTarget,
      status: entry.status
    })));
    const format = options.format === 'xlsx' ? 'xlsx' : 'csv';
    const outputPath = path.join(exportsDir, `history-export-${now()}.${format}`);
    if (format === 'csv') {
      const sheet = XLSX.utils.json_to_sheet(rows);
      fs.writeFileSync(outputPath, XLSX.utils.sheet_to_csv(sheet), 'utf8');
    } else {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'History');
      XLSX.writeFile(workbook, outputPath);
    }
    return { path: outputPath, count: rows.length };
  }

  return { exportHistory };
}

module.exports = {
  createRuntimeHistoryExport
};
