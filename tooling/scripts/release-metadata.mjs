import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_RELEASE_REPOSITORY = 'langlink-localization/memoq-ai-hub';
export const STABLE_UPDATE_MANIFEST_NAME = 'memoq-ai-hub-updates-stable.json';
export const PORTABLE_WINDOWS_ARTIFACT_NAME = 'memoq-ai-hub-win32-x64.zip';

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

export function validateReleaseCommitOnRef(commitSha, refName = 'origin/main', repoRoot = getRepoRoot()) {
  const normalizedCommit = String(commitSha || '').trim();
  const normalizedRef = String(refName || '').trim() || 'origin/main';

  if (!normalizedCommit) {
    throw new Error(`A release commit SHA is required to validate ancestry against ${normalizedRef}.`);
  }

  try {
    execFileSync('git', ['merge-base', '--is-ancestor', normalizedCommit, normalizedRef], {
      cwd: repoRoot,
      stdio: 'ignore'
    });
  } catch (error) {
    throw new Error(`Release commit ${normalizedCommit} is not reachable from ${normalizedRef}. Create release tags from the main release line.`);
  }

  return {
    commitSha: normalizedCommit,
    refName: normalizedRef
  };
}

export function buildStableUpdateManifest({
  version = getDesktopPackageVersion(),
  repository = DEFAULT_RELEASE_REPOSITORY,
  publishedAt = '',
  releaseNotes = ''
} = {}) {
  const normalizedVersion = String(version || '').trim().replace(/^v/i, '');
  if (!normalizedVersion) {
    throw new Error('A release version is required to build the update manifest.');
  }

  const normalizedRepository = String(repository || DEFAULT_RELEASE_REPOSITORY).trim() || DEFAULT_RELEASE_REPOSITORY;
  const tag = `v${normalizedVersion}`;
  const releaseBaseUrl = `https://github.com/${normalizedRepository}/releases`;
  const downloadBaseUrl = `${releaseBaseUrl}/download/${tag}`;

  return {
    version: normalizedVersion,
    tag,
    channel: 'stable',
    publishedAt: String(publishedAt || '').trim(),
    releaseNotes: String(releaseNotes || '').trim(),
    releaseNotesUrl: `${releaseBaseUrl}/tag/${tag}`,
    assets: {
      portable: {
        name: PORTABLE_WINDOWS_ARTIFACT_NAME,
        url: `${downloadBaseUrl}/${PORTABLE_WINDOWS_ARTIFACT_NAME}`
      }
    }
  };
}

export function writeStableUpdateManifest(outputPath, options = {}) {
  const manifest = buildStableUpdateManifest(options);
  const resolvedOutputPath = path.resolve(String(outputPath || ''));

  if (!resolvedOutputPath) {
    throw new Error('An output path is required to write the update manifest.');
  }

  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  fs.writeFileSync(resolvedOutputPath, JSON.stringify(manifest, null, 2), 'utf8');
  return {
    outputPath: resolvedOutputPath,
    manifest
  };
}

function printUsage() {
  console.error('Usage: node tooling/scripts/release-metadata.mjs <version|check-tag|check-mainline|write-manifest> [args]');
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

  if (command === 'check-mainline') {
    const result = validateReleaseCommitOnRef(value, argv[2] || 'origin/main');
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (command === 'write-manifest') {
    const outputPath = value;
    const publishedAt = argv[2] || '';
    const repository = argv[3] || DEFAULT_RELEASE_REPOSITORY;
    const result = writeStableUpdateManifest(outputPath, {
      publishedAt,
      repository
    });
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
