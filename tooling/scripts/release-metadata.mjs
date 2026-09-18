import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_RELEASE_REPOSITORY = 'langlink-localization/memoq-ai-hub';
export const STABLE_UPDATE_MANIFEST_NAME = 'memoq-ai-hub-updates-stable.json';
export const PORTABLE_WINDOWS_ARTIFACT_NAME = 'memoq-ai-hub-win32-x64.zip';
export const COMPACT_PORTABLE_WINDOWS_ARTIFACT_NAME = 'memoq-ai-hub-win32-x64.7z';
export const INSTALLER_WINDOWS_ARTIFACT_NAME = 'memoq-ai-hub-setup.exe';
export const INSTALLER_WINDOWS_ARTIFACT_RELATIVE_PATH = path.join('make', 'squirrel.windows', 'x64', 'memoq-ai-hub-setup.exe');
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

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

export function normalizeSha256(value, label = 'Asset SHA-256') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!SHA256_HEX_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a 64-character hexadecimal digest.`);
  }
  return normalized;
}

export function calculateFileSha256(filePath) {
  const normalizedPath = String(filePath || '').trim();
  if (!normalizedPath) {
    throw new Error('A release artifact path is required to calculate SHA-256.');
  }

  const resolvedPath = path.resolve(normalizedPath);
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    throw new Error(`Release artifact not found: ${resolvedPath}`);
  }

  return createHash('sha256').update(fs.readFileSync(resolvedPath)).digest('hex');
}

export function buildStableUpdateManifest({
  version = getDesktopPackageVersion(),
  repository = DEFAULT_RELEASE_REPOSITORY,
  publishedAt = '',
  releaseNotes = '',
  assetSha256 = {}
} = {}) {
  const normalizedVersion = String(version || '').trim().replace(/^v/i, '');
  if (!normalizedVersion) {
    throw new Error('A release version is required to build the update manifest.');
  }

  const normalizedRepository = String(repository || DEFAULT_RELEASE_REPOSITORY).trim() || DEFAULT_RELEASE_REPOSITORY;
  const tag = `v${normalizedVersion}`;
  const releaseBaseUrl = `https://github.com/${normalizedRepository}/releases`;
  const downloadBaseUrl = `${releaseBaseUrl}/download/${tag}`;
  const portableSha256 = normalizeSha256(assetSha256.portable, 'Portable ZIP SHA-256');
  const portableCompactSha256 = normalizeSha256(assetSha256.portableCompact, 'Compact 7z SHA-256');
  const installerSha256 = normalizeSha256(assetSha256.installer, 'Windows installer SHA-256');

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
        url: `${downloadBaseUrl}/${PORTABLE_WINDOWS_ARTIFACT_NAME}`,
        sha256: portableSha256
      },
      portableCompact: {
        name: COMPACT_PORTABLE_WINDOWS_ARTIFACT_NAME,
        url: `${downloadBaseUrl}/${COMPACT_PORTABLE_WINDOWS_ARTIFACT_NAME}`,
        sha256: portableCompactSha256
      },
      installer: {
        name: INSTALLER_WINDOWS_ARTIFACT_NAME,
        url: `${downloadBaseUrl}/${INSTALLER_WINDOWS_ARTIFACT_NAME}`,
        sha256: installerSha256
      }
    }
  };
}

export function writeStableUpdateManifest(outputPath, options = {}) {
  const normalizedOutputPath = String(outputPath || '').trim();
  if (!normalizedOutputPath) {
    throw new Error('An output path is required to write the update manifest.');
  }

  const resolvedOutputPath = path.resolve(normalizedOutputPath);
  const outputDir = path.dirname(resolvedOutputPath);
  const manifest = buildStableUpdateManifest({
    ...options,
    assetSha256: {
      portable: options.assetSha256?.portable
        || calculateFileSha256(path.join(outputDir, PORTABLE_WINDOWS_ARTIFACT_NAME)),
      portableCompact: options.assetSha256?.portableCompact
        || calculateFileSha256(path.join(outputDir, COMPACT_PORTABLE_WINDOWS_ARTIFACT_NAME)),
      installer: options.assetSha256?.installer
        || calculateFileSha256(path.join(outputDir, INSTALLER_WINDOWS_ARTIFACT_RELATIVE_PATH))
    }
  });

  fs.mkdirSync(outputDir, { recursive: true });
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
