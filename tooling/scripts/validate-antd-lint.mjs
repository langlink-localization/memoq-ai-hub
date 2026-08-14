let input = '';
for await (const chunk of process.stdin) input += chunk;

let report;
try {
  report = JSON.parse(input);
} catch (error) {
  console.error(`Ant Design lint did not return valid JSON: ${error.message}`);
  process.exit(1);
}

const issues = Array.isArray(report.issues) ? report.issues : null;
const skippedFiles = Array.isArray(report.skippedFiles) ? report.skippedFiles : null;
if (!issues || !skippedFiles || report.partial !== false || skippedFiles.length > 0 || issues.length > 0) {
  console.error(JSON.stringify({ partial: report.partial, skippedFiles, issues }, null, 2));
  process.exit(1);
}
console.log(`Ant Design lint passed: ${report.summary?.total ?? 0} findings, no skipped files, full scan.`);
