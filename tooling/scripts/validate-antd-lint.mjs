#!/usr/bin/env node
// Fail-closed validator for `antd lint --format json` reports.
// Rejects malformed or schema-drifted reports instead of silently passing.
// Self-test: `node tooling/scripts/validate-antd-lint.mjs --selftest`

const KNOWN_RULE_CATEGORIES = ['a11y', 'deprecated', 'performance', 'usage'];
const KNOWN_SEVERITIES = ['error', 'warning'];
const SUMMARY_COUNTERS = ['total', ...KNOWN_RULE_CATEGORIES, 'skipped'];
const SKIPPED_FILE_FIELDS = ['file', 'reason', 'message'];
const ISSUE_STRING_FIELDS = ['file', 'rule', 'severity', 'message'];

function typeName(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function validateReport(report) {
  const errors = [];
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return [`report must be a JSON object, got ${typeName(report)}`];
  }

  const { issues, partial, skippedFiles, summary } = report;

  if (!Array.isArray(issues)) {
    errors.push(`"issues" must be an array, got ${typeName(issues)}`);
  } else {
    issues.forEach((issue, index) => {
      const prefix = `issues[${index}]`;
      if (!issue || typeof issue !== 'object' || Array.isArray(issue)) {
        errors.push(`${prefix} must be an object, got ${typeName(issue)}`);
        return;
      }
      for (const field of ISSUE_STRING_FIELDS) {
        if (typeof issue[field] !== 'string') {
          errors.push(`${prefix}.${field} must be a string, got ${typeName(issue[field])}`);
        }
      }
      if (typeof issue.line !== 'number' || !Number.isInteger(issue.line) || issue.line < 0) {
        errors.push(`${prefix}.line must be a non-negative integer, got ${typeName(issue.line)}`);
      }
      if (typeof issue.rule === 'string' && !KNOWN_RULE_CATEGORIES.includes(issue.rule)) {
        errors.push(`${prefix}.rule "${issue.rule}" is not a known rule category (expected one of: ${KNOWN_RULE_CATEGORIES.join(', ')})`);
      }
      if (typeof issue.severity === 'string' && !KNOWN_SEVERITIES.includes(issue.severity)) {
        errors.push(`${prefix}.severity "${issue.severity}" is not a known severity (expected one of: ${KNOWN_SEVERITIES.join(', ')})`);
      }
    });
  }

  if (typeof partial !== 'boolean') {
    errors.push(`"partial" must be a boolean, got ${typeName(partial)}`);
  }

  if (!Array.isArray(skippedFiles)) {
    errors.push(`"skippedFiles" must be an array, got ${typeName(skippedFiles)}`);
  } else {
    skippedFiles.forEach((entry, index) => {
      const prefix = `skippedFiles[${index}]`;
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        errors.push(`${prefix} must be an object, got ${typeName(entry)}`);
        return;
      }
      for (const field of SKIPPED_FILE_FIELDS) {
        if (typeof entry[field] !== 'string') {
          errors.push(`${prefix}.${field} must be a string, got ${typeName(entry[field])}`);
        }
      }
    });
  }

  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    errors.push(`"summary" must be an object, got ${typeName(summary)}`);
  } else {
    for (const counter of SUMMARY_COUNTERS) {
      if (typeof summary[counter] !== 'number' || !Number.isInteger(summary[counter]) || summary[counter] < 0) {
        errors.push(`summary.${counter} must be a non-negative integer, got ${typeName(summary[counter])}`);
      }
    }
    for (const key of Object.keys(summary)) {
      if (!SUMMARY_COUNTERS.includes(key)) {
        errors.push(`summary.${key} is not a known counter (schema drift; expected keys: ${SUMMARY_COUNTERS.join(', ')})`);
      }
    }
    if (Array.isArray(issues) && Number.isInteger(summary.total) && summary.total !== issues.length) {
      errors.push(`summary.total (${summary.total}) does not match issues.length (${issues.length})`);
    }
    if (Array.isArray(skippedFiles) && Number.isInteger(summary.skipped) && summary.skipped !== skippedFiles.length) {
      errors.push(`summary.skipped (${summary.skipped}) does not match skippedFiles.length (${skippedFiles.length})`);
    }
    if (typeof partial === 'boolean' && Array.isArray(skippedFiles) && partial !== (skippedFiles.length > 0)) {
      errors.push(`"partial" (${partial}) contradicts skippedFiles.length (${skippedFiles.length})`);
    }
    if (Array.isArray(issues)) {
      for (const category of KNOWN_RULE_CATEGORIES) {
        const count = issues.filter((issue) => issue && issue.rule === category).length;
        if (Number.isInteger(summary[category]) && summary[category] !== count) {
          errors.push(`summary.${category} (${summary[category]}) does not match the number of "${category}" issues (${count})`);
        }
      }
    }
  }

  return errors;
}

function evaluateGate(report) {
  const schemaErrors = validateReport(report);
  if (schemaErrors.length > 0) {
    return { ok: false, schemaRejected: true, errors: schemaErrors };
  }
  const errors = [];
  if (report.partial !== false) {
    errors.push('partial scan (report.partial is not false)');
  }
  if (report.skippedFiles.length > 0) {
    errors.push(`${report.skippedFiles.length} skipped file(s)`);
  }
  if (report.issues.length > 0) {
    errors.push(`${report.issues.length} finding(s)`);
  }
  return { ok: errors.length === 0, schemaRejected: false, errors };
}

function buildSelfTestCases() {
  const validReport = {
    issues: [],
    skippedFiles: [],
    partial: false,
    summary: { total: 0, deprecated: 0, a11y: 0, usage: 0, performance: 0, skipped: 0 }
  };
  return [
    {
      name: 'valid clean report passes',
      report: validReport,
      expectOk: true
    },
    {
      name: 'valid report with one known-category issue fails the gate on findings',
      report: {
        ...validReport,
        issues: [{ file: 'a.jsx', line: 3, rule: 'a11y', severity: 'warning', message: 'x' }],
        summary: { total: 1, deprecated: 0, a11y: 1, usage: 0, performance: 0, skipped: 0 }
      },
      expectOk: false
    },
    {
      name: 'non-object report is rejected',
      report: [],
      expectOk: false,
      expectSchemaRejected: true
    },
    {
      name: 'missing summary is rejected',
      report: { issues: [], skippedFiles: [], partial: false },
      expectOk: false,
      expectSchemaRejected: true
    },
    {
      name: 'malformed summary counter (string total) is rejected',
      report: { ...validReport, summary: { ...validReport.summary, total: '0' } },
      expectOk: false,
      expectSchemaRejected: true
    },
    {
      name: 'unknown summary counter is rejected',
      report: { ...validReport, summary: { ...validReport.summary, security: 0 } },
      expectOk: false,
      expectSchemaRejected: true
    },
    {
      name: 'summary.total mismatch with issues.length is rejected',
      report: {
        ...validReport,
        issues: [{ file: 'a.jsx', line: 1, rule: 'usage', severity: 'error', message: 'x' }],
        summary: { total: 0, deprecated: 0, a11y: 0, usage: 0, performance: 0, skipped: 0 }
      },
      expectOk: false,
      expectSchemaRejected: true
    },
    {
      name: 'summary category counter mismatch is rejected',
      report: {
        ...validReport,
        issues: [{ file: 'a.jsx', line: 1, rule: 'usage', severity: 'error', message: 'x' }],
        summary: { total: 1, deprecated: 0, a11y: 1, usage: 0, performance: 0, skipped: 0 }
      },
      expectOk: false,
      expectSchemaRejected: true
    },
    {
      name: 'unknown rule category in issue is rejected',
      report: {
        ...validReport,
        issues: [{ file: 'a.jsx', line: 1, rule: 'security', severity: 'error', message: 'x' }],
        summary: { total: 1, deprecated: 0, a11y: 0, usage: 0, performance: 0, skipped: 1 }
      },
      expectOk: false,
      expectSchemaRejected: true
    },
    {
      name: 'unknown severity in issue is rejected',
      report: {
        ...validReport,
        issues: [{ file: 'a.jsx', line: 1, rule: 'a11y', severity: 'fatal', message: 'x' }],
        summary: { total: 1, deprecated: 0, a11y: 1, usage: 0, performance: 0, skipped: 0 }
      },
      expectOk: false,
      expectSchemaRejected: true
    },
    {
      name: 'issue missing message is rejected',
      report: {
        ...validReport,
        issues: [{ file: 'a.jsx', line: 1, rule: 'a11y', severity: 'error' }],
        summary: { total: 1, deprecated: 0, a11y: 1, usage: 0, performance: 0, skipped: 0 }
      },
      expectOk: false,
      expectSchemaRejected: true
    },
    {
      name: 'non-boolean partial is rejected',
      report: { ...validReport, partial: 'false' },
      expectOk: false,
      expectSchemaRejected: true
    },
    {
      name: 'missing skippedFiles is rejected',
      report: { issues: [], partial: false, summary: validReport.summary },
      expectOk: false,
      expectSchemaRejected: true
    },
    {
      name: 'skipped entry missing reason is rejected',
      report: {
        ...validReport,
        skippedFiles: [{ file: 'a.jsx', message: 'unparseable' }],
        partial: true,
        summary: { ...validReport.summary, skipped: 1 }
      },
      expectOk: false,
      expectSchemaRejected: true
    },
    {
      name: 'partial flag contradicting empty skippedFiles is rejected',
      report: { ...validReport, partial: true },
      expectOk: false,
      expectSchemaRejected: true
    },
    {
      name: 'summary.skipped mismatch with skippedFiles.length is rejected',
      report: {
        ...validReport,
        skippedFiles: [{ file: 'a.jsx', reason: 'parse-error', message: 'unparseable' }],
        partial: true,
        summary: { ...validReport.summary, skipped: 0 }
      },
      expectOk: false,
      expectSchemaRejected: true
    }
  ];
}

function runSelfTest() {
  const cases = buildSelfTestCases();
  let failed = 0;
  for (const testCase of cases) {
    const result = evaluateGate(testCase.report);
    const ok = result.ok === testCase.expectOk
      && (testCase.expectSchemaRejected ? result.schemaRejected === true : true);
    if (ok) {
      console.log(`ok - ${testCase.name}`);
    } else {
      failed += 1;
      console.error(`not ok - ${testCase.name}`);
      console.error(`  expected ok=${testCase.expectOk}${testCase.expectSchemaRejected ? ' (schema rejection)' : ''}, got ok=${result.ok} schemaRejected=${result.schemaRejected}`);
      console.error(`  errors: ${JSON.stringify(result.errors)}`);
    }
  }
  console.log(`${cases.length - failed}/${cases.length} self-test cases passed`);
  if (failed > 0) process.exit(1);
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let report;
  try {
    report = JSON.parse(input);
  } catch (error) {
    console.error(`Ant Design lint did not return valid JSON: ${error.message}`);
    process.exit(1);
  }

  const result = evaluateGate(report);
  if (result.schemaRejected) {
    console.error('Ant Design lint report failed schema validation (refusing to trust a malformed report):');
    for (const error of result.errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  if (!result.ok) {
    console.error(JSON.stringify({ partial: report.partial, skippedFiles: report.skippedFiles, issues: report.issues }, null, 2));
    process.exit(1);
  }
  console.log(`Ant Design lint passed: ${report.summary.total} findings, no skipped files, full scan.`);
}

if (process.argv.slice(2).includes('--selftest')) {
  runSelfTest();
} else {
  await main();
}
