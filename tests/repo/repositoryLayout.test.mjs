import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

function readFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('repository layout exposes the governed top-level directories', () => {
  const requiredDirs = [
    'assets',
    'docs',
    'apps',
    'apps/desktop',
    'native',
    'native/plugin',
    'native/preview-helper',
    'packages',
    'packages/contracts',
    'tooling',
    'tooling/build',
    'tooling/scripts',
    'tests',
    'tests/repo',
  ];

  for (const relativePath of requiredDirs) {
    assert.equal(
      fs.existsSync(path.join(repoRoot, relativePath)),
      true,
      `expected ${relativePath} to exist`
    );
  }
});

test('legacy root directories stay removed', () => {
  const forbiddenDirs = [
    'build',
    'desktop',
    'plugin',
    'preview-helper',
    'scripts',
    'shared-contracts',
    'test',
  ];

  for (const relativePath of forbiddenDirs) {
    assert.equal(fs.existsSync(path.join(repoRoot, relativePath)), false, `did not expect ${relativePath} to exist`);
  }
});

test('documentation is canonicalized under docs/reference', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'docs', 'reference')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'doc')), false);
});

test('gitignore protects generated outputs and local scratch paths', () => {
  const gitignore = readFile('.gitignore');
  const requiredEntries = [
    'apps/desktop/.vite/',
    'apps/desktop/out/',
    'apps/desktop/make/',
    'apps/desktop/test-output/',
    'apps/desktop/build-resources/memoq-integration/',
    'apps/desktop/helper/',
    '.tmp/',
    '.worktrees/',
    'artifacts/',
    'native/plugin/**/bin/',
    'native/plugin/**/obj/',
    'native/preview-helper/**/bin/',
    'native/preview-helper/**/obj/',
    'native/preview-helper/**/obj-*/',
  ];

  for (const entry of requiredEntries) {
    assert.match(gitignore, new RegExp(`^${entry.replaceAll('/', '\\/').replaceAll('*', '\\*')}$`, 'm'));
  }
});

test('README points contributors to docs-based structure guidance', () => {
  const readme = readFile('README.md');

  assert.match(readme, /`docs\//);
  assert.doesNotMatch(readme, /`doc\//);
  assert.match(readme, /Repository Structure/);
  assert.match(readme, /`apps\/desktop\//);
  assert.match(readme, /`tooling\/scripts\//);
});

test('path-sensitive entrypoints use the monorepo topology', () => {
  const ciWorkflow = readFile('.github/workflows/ci.yml');
  const releaseWorkflow = readFile('.github/workflows/release.yml');
  const rootPackage = readFile('package.json');
  const forgeConfig = readFile('apps/desktop/forge.config.js');
  const desktopContract = readFile('apps/desktop/src/shared/desktopContract.js');
  const integrationService = readFile('apps/desktop/src/integration/integrationService.js');

  assert.match(ciWorkflow, /apps\/desktop\/package\.json/);
  assert.match(ciWorkflow, /tooling\/scripts\/build-windows\.ps1/);
  assert.match(ciWorkflow, /tooling\/build\/prepare-desktop-release\.ps1/);
  assert.match(ciWorkflow, /apps\/desktop\/out\/\*\*\/\*\.zip/);

  assert.match(releaseWorkflow, /tooling\/scripts\/release-metadata\.mjs/);
  assert.match(releaseWorkflow, /tooling\/scripts\/package-windows\.ps1/);
  assert.match(releaseWorkflow, /apps\/desktop\/out\/\*\*\/\*\.zip/);
  assert.match(releaseWorkflow, /apps\/desktop\/out\/make\/squirrel\.windows\/\*\*\/RELEASES/);
  assert.match(releaseWorkflow, /apps\/desktop\/out\/make\/squirrel\.windows\/\*\*\/\*\.nupkg/);
  assert.match(releaseWorkflow, /apps\/desktop\/out\/make\/squirrel\.windows\/\*\*\/\*\.exe/);
  assert.match(releaseWorkflow, /apps\/desktop\/out\/memoq-ai-hub-updates-stable\.json/);

  assert.match(rootPackage, /tooling\\\\scripts\\\\build-windows\.ps1/);
  assert.match(rootPackage, /tooling\\\\build\\\\prepare-desktop-release\.ps1/);
  assert.match(rootPackage, /tests\/repo\/\*\.test\.mjs/);

  assert.match(forgeConfig, /native', 'plugin/);
  assert.match(forgeConfig, /native', 'preview-helper/);
  assert.match(forgeConfig, /packages', 'contracts', 'desktop-contract\.json/);
  assert.doesNotMatch(forgeConfig, /shared-contracts/);

  assert.match(desktopContract, /desktop-contract\.json/);
  assert.doesNotMatch(desktopContract, /shared-contracts/);

  assert.match(integrationService, /native', 'plugin/);
  assert.match(integrationService, /apps', 'desktop', 'build-resources/);
  assert.match(integrationService, /docs', 'reference', INTEGRATION\.clientDevConfigName/);
  assert.doesNotMatch(integrationService, /'doc'/);
});



