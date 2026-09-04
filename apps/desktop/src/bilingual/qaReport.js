'use strict';

const fs = require('fs');
const path = require('path');

/**
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => /** @type {string} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

/**
 * @param {unknown} value
 * @returns {string}
 */
const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

/**
 * @typedef {Object} QaReportDocumentResult
 * @property {Array<{
 *   document?: { id?: unknown, name?: unknown },
 *   segment?: { segmentIndex?: unknown },
 *   findings?: Array<Record<string, unknown>>
 * }>=} results
 * @property {{ id?: unknown, name?: unknown }=} document
 */

/**
 * @param {QaReportDocumentResult} documentResult
 * @returns {Array<Record<string, unknown>>}
 */
function flattenResults(documentResult) {
  return (documentResult.results || []).flatMap((result) => (result.findings || []).map((finding) => ({
    documentId: result.document?.id || documentResult.document?.id || '', documentName: result.document?.name || documentResult.document?.name || '',
    segmentIndex: result.segment?.segmentIndex ?? '', findingId: finding.id, category: finding.category, severity: finding.severity,
    title: finding.title, message: finding.message, sourceEvidence: finding.sourceEvidence, targetEvidence: finding.targetEvidence,
    suggestedTranslation: finding.suggestedTranslation, confidence: finding.confidence, origin: finding.origin
  })));
}

/**
 * @param {QaReportDocumentResult} documentResult
 * @param {string} outputDir
 * @param {string=} baseName
 */
function writeQaReports(documentResult, outputDir, baseName = 'qa-report') {
  fs.mkdirSync(outputDir, { recursive: true });
  const safeBase = String(baseName || 'qa-report').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'qa-report';
  const rows = /** @type {Array<Record<string, unknown>>} */ (flattenResults(documentResult));
  const jsonPath = path.join(outputDir, `${safeBase}.json`);
  const csvPath = path.join(outputDir, `${safeBase}.csv`);
  const htmlPath = path.join(outputDir, `${safeBase}.html`);
  fs.writeFileSync(jsonPath, JSON.stringify(documentResult, null, 2), 'utf8');
  const headers = ['documentId', 'documentName', 'segmentIndex', 'findingId', 'category', 'severity', 'title', 'message', 'sourceEvidence', 'targetEvidence', 'suggestedTranslation', 'confidence', 'origin'];
  fs.writeFileSync(csvPath, [headers.map(csvCell).join(','), ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(','))].join('\n'), 'utf8');
  const htmlRows = rows.map((row) => `<tr>${headers.map((key) => `<td>${escapeHtml(row[key])}</td>`).join('')}</tr>`).join('\n');
  fs.writeFileSync(htmlPath, `<!doctype html><html><head><meta charset="utf-8"><title>memoQ AI Hub QA report</title><style>body{font-family:Segoe UI,Arial,sans-serif;margin:24px;color:#1f1f1f}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d9d9d9;padding:8px;text-align:left;vertical-align:top}th{background:#fafafa}</style></head><body><h1>memoQ AI Hub QA report</h1><p>This report may contain customer source and target text. Handle it according to the project data policy.</p><table><thead><tr>${headers.map((key) => `<th>${escapeHtml(key)}</th>`).join('')}</tr></thead><tbody>${htmlRows}</tbody></table></body></html>`, 'utf8');
  return { jsonPath, csvPath, htmlPath, findingCount: rows.length };
}

module.exports = { flattenResults, writeQaReports };
