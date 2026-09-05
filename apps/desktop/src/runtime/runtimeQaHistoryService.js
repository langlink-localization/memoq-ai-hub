'use strict';

const fs = require('fs');
const path = require('path');

/**
 * @param {Record<string, any>} options
 */
function createRuntimeQaHistoryService(options = {}) {
  const { persistence, exportsDir } = options;
  const loadXlsx = options.loadXlsx || (() => require('xlsx'));
  const now = options.now || Date.now;

  if (!persistence) {
    throw new TypeError('QA history persistence is required.');
  }
  if (!exportsDir) {
    throw new TypeError('QA history exports directory is required.');
  }

  function list(filters = {}) {
    return { items: persistence.listQaResultsAll(filters || {}) };
  }

  /**
   * @param {Record<string, any>=} payload
   */
  function getEntry(payload = {}) {
    const requestId = String(payload?.requestId || '').trim();
    const result = persistence.readQaResult(requestId);
    if (!result) {
      return null;
    }
    const item = persistence.listQaResultsAll({ limit: 500 })
      .find((/** @type {any} */ entry) => entry.requestId === requestId) || null;
    return { result, item, feedback: persistence.listQaFeedback(requestId) };
  }

  /**
   * @param {any[]=} requestIds
   */
  function remove(requestIds = []) {
    return persistence.deleteQaResults(requestIds);
  }

  /**
   * @param {Record<string, any>=} options
   */
  function exportHistory(options = {}) {
    const XLSX = loadXlsx();
    const items = options.scope === 'selected'
      ? persistence.listQaResultsAll({ limit: 500 })
        .filter((/** @type {any} */ item) => (options.selectedIds || []).includes(item.requestId))
      : persistence.listQaResultsAll(options.filters || {});
    const rows = items.map((/** @type {any} */ item) => ({
      requestId: item.requestId,
      checkedAt: item.updatedAt,
      document: item.documentName || item.documentId,
      trigger: item.trigger,
      status: item.status,
      source: item.segment?.source || '',
      target: item.segment?.target || '',
      critical: item.findingCounts?.critical || 0,
      major: item.findingCounts?.major || 0,
      minor: item.findingCounts?.minor || 0,
      info: item.findingCounts?.info || 0,
      aiStatus: item.execution?.aiStatus || '',
      aiModel: item.execution?.aiModel || ''
    }));
    const format = options.format === 'xlsx' ? 'xlsx' : 'csv';
    const outputPath = path.join(exportsDir, `qa-history-export-${now()}.${format}`);
    const sheet = XLSX.utils.json_to_sheet(rows);
    if (format === 'csv') {
      fs.writeFileSync(outputPath, XLSX.utils.sheet_to_csv(sheet), 'utf8');
    } else {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, 'QA History');
      XLSX.writeFile(workbook, outputPath);
    }
    return { path: outputPath, count: rows.length };
  }

  return { list, getEntry, remove, exportHistory };
}

module.exports = { createRuntimeQaHistoryService };
