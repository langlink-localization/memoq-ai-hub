'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { XMLParser } = require('fast-xml-parser');

const SUPPORTED_EXTENSIONS = new Set(['.mqxliff', '.xlf', '.xliff']);
/** @param {unknown} value @returns {any[]} */
const asArray = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]);

// XLIFF nodes come from fast-xml-parser as arbitrary nested records; the
// accessors below intentionally treat them as untyped shapes.
/**
 * @param {any} value
 * @returns {string}
 */
function textContent(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(textContent).join('');
  if (typeof value === 'object') {
    return Object.entries(value).filter(([key]) => !key.startsWith('@_')).map(([key, child]) => {
      if (key === '#text') return textContent(child);
      if (/^(?:ph|x|bx|ex|g|pc|sc|ec|bpt|ept|it)$/i.test(key)) {
        return asArray(child).map((node, index) => `<${key} id="${String(node?.['@_id'] || node?.['@_rid'] || index + 1)}"/>`).join('');
      }
      return textContent(child);
    }).join('');
  }
  return '';
}

/**
 * @param {any=} node
 * @param {any[]=} results
 * @returns {any[]}
 */
function collectTransUnits(node, results = []) {
  if (!node || typeof node !== 'object') return results;
  if (Array.isArray(node)) {
    node.forEach((child) => collectTransUnits(child, results));
    return results;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'trans-unit') {
      asArray(value).forEach((unit) => results.push({
        id: String(unit?.['@_id'] || unit?.['@_resname'] || results.length + 1),
        source: textContent(unit?.source),
        target: textContent(unit?.target),
        status: String(unit?.target?.['@_state'] || unit?.['@_approved'] || '')
      }));
    } else {
      collectTransUnits(value, results);
    }
  }
  return results;
}

/**
 * @param {any=} node
 * @param {string=} unitId
 * @param {any[]=} results
 * @returns {any[]}
 */
function collectXliff2Segments(node, unitId = '', results = []) {
  if (!node || typeof node !== 'object') return results;
  if (Array.isArray(node)) {
    node.forEach((child) => collectXliff2Segments(child, unitId, results));
    return results;
  }
  const nextUnitId = String(node?.['@_id'] || unitId || '');
  if (Object.hasOwn(node, 'segment')) {
    asArray(node.segment).forEach((segment, index) => results.push({
      id: String(segment?.['@_id'] || `${nextUnitId || 'unit'}:${index + 1}`),
      source: textContent(segment?.source),
      target: textContent(segment?.target),
      status: String(segment?.['@_state'] || '')
    }));
  }
  for (const [key, value] of Object.entries(node)) {
    if (!key.startsWith('@_') && key !== 'segment') collectXliff2Segments(value, nextUnitId, results);
  }
  return results;
}

/**
 * @typedef {Object} ParsedBilingualFile
 * @property {{ id: string, name: string }} document
 * @property {{ source: string, target: string }} languages
 * @property {Array<{ id: string, source: string, target: string, status: string, segmentIndex: number }>} segments
 */

/**
 * @param {unknown} content
 * @param {{ fileName?: unknown }=} options
 * @returns {ParsedBilingualFile}
 */
function parseBilingualContent(content, options = {}) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', trimValues: false });
  const parsed = parser.parse(String(content || ''));
  const root = parsed?.xliff || parsed;
  const file = asArray(root?.file)[0] || {};
  const sourceLanguage = String(root?.['@_srcLang'] || root?.['@_source-language'] || file?.['@_source-language'] || '');
  const targetLanguage = String(root?.['@_trgLang'] || root?.['@_target-language'] || file?.['@_target-language'] || '');
  let segments = collectTransUnits(root, []);
  if (!segments.length) segments = collectXliff2Segments(root, '', []);
  segments = segments.map((segment, index) => ({ ...segment, segmentIndex: index })).filter((segment) => segment.source.trim() || segment.target.trim());
  if (!segments.length) throw new Error('The bilingual file does not contain readable XLIFF segments.');
  const name = String(options.fileName || 'imported.xliff');
  return {
    document: { id: crypto.createHash('sha256').update(`${name}\n${String(content || '')}`).digest('hex').slice(0, 32), name },
    languages: { source: sourceLanguage, target: targetLanguage },
    segments
  };
}

/**
 * @param {unknown} filePath
 * @returns {ParsedBilingualFile}
 */
function parseBilingualFile(filePath) {
  const resolvedPath = path.resolve(String(filePath || ''));
  if (!SUPPORTED_EXTENSIONS.has(path.extname(resolvedPath).toLowerCase())) throw new Error('Only MQXLIFF, XLF, and XLIFF files are supported.');
  return parseBilingualContent(fs.readFileSync(resolvedPath, 'utf8'), { fileName: path.basename(resolvedPath) });
}

module.exports = { SUPPORTED_EXTENSIONS, parseBilingualContent, parseBilingualFile, textContent };
