import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function getRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function getDesktopPackageVersion(repoRoot = getRepoRoot()) {
  const packageJsonPath = path.join(repoRoot, 'apps', 'desktop', 'package.json');
  const packageJson = readJson(packageJsonPath);
  const version = String(packageJson.version || '').trim();

  if (!version) {
    throw new Error(`apps/desktop/package.json is missing a version field: ${packageJsonPath}`);
  }

  return version;
}

export function validateReleaseTag(tagName, repoRoot = getRepoRoot()) {
  const version = getDesktopPackageVersion(repoRoot);
  const expectedTag = `v${version}`;
  const normalizedTag = String(tagName || '').trim();

  if (!normalizedTag) {
    throw new Error(`Release tag is required. Expected ${expectedTag}.`);
  }

  if (normalizedTag !== expectedTag) {
    throw new Error(`Release tag ${normalizedTag} does not match apps/desktop/package.json version ${version}. Expected ${expectedTag}.`);
  }

  return {
    version,
    tag: expectedTag
  };
}

function printUsage() {
  console.error('Usage: node tooling/scripts/release-metadata.mjs <version|check-tag> [tag]');
}

function main(argv = process.argv.slice(2)) {
  const [command, value] = argv;

  if (command === 'version') {
    process.stdout.write(`${getDesktopPackageVersion()}\n`);
    return;
  }

  if (command === 'check-tag') {
    const result = validateReleaseTag(value);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  printUsage();
  process.exitCode = 1;
}

const entryFilePath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (entryFilePath && fileURLToPath(import.meta.url) === entryFilePath) {
  main();
}
