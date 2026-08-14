import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

function normalizeLineEndings(content) {
  return content.replace(/\r\n?/g, '\n');
}

function readFile(relativePath) {
  return normalizeLineEndings(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

test('repository text fixtures normalize platform line endings', () => {
  assert.equal(normalizeLineEndings('one\r\ntwo\rthree\n'), 'one\ntwo\nthree\n');
});

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

  assert.doesNotMatch(gitignore, /^pnpm-lock\.yaml$/m);
});

test('dependency and CI governance is reproducible', () => {
  const rootPackage = JSON.parse(readFile('package.json'));
  const desktopPackage = JSON.parse(readFile('apps/desktop/package.json'));
  const lockfile = readFile('pnpm-lock.yaml');
  const ciWorkflow = readFile('.github/workflows/ci.yml');
  const releaseWorkflow = readFile('.github/workflows/release.yml');
  const packageWindowsScript = readFile('tooling/scripts/package-windows.ps1');

  assert.deepEqual(rootPackage.pnpm?.onlyBuiltDependencies, [
    'electron',
    'electron-winstaller',
    'esbuild',
  ]);
  assert.equal(rootPackage.engines?.node, '>=22.12.0');
  assert.equal(desktopPackage.engines?.node, '>=22.12.0');
  assert.match(packageWindowsScript, /Ensure-NodeVersion \$nodeExecutable \(\[version\]"22\.12\.0"\)/);
  assert.equal(desktopPackage.dependencies?.['body-parser'], '1.20.6');
  assert.equal(
    desktopPackage.dependencies?.xlsx,
    'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz'
  );
  assert.deepEqual(
    {
      electron: desktopPackage.devDependencies?.electron,
      forgeCli: desktopPackage.devDependencies?.['@electron-forge/cli'],
      forgeSquirrel: desktopPackage.devDependencies?.['@electron-forge/maker-squirrel'],
      forgeVite: desktopPackage.devDependencies?.['@electron-forge/plugin-vite'],
      forgeZip: desktopPackage.devDependencies?.['@electron-forge/maker-zip'],
      pluginReact: desktopPackage.devDependencies?.['@vitejs/plugin-react'],
      vite: desktopPackage.devDependencies?.vite,
    },
    {
      electron: '43.2.0',
      forgeCli: '7.11.2',
      forgeSquirrel: '7.11.2',
      forgeVite: '7.11.2',
      forgeZip: '7.11.2',
      pluginReact: '6.0.5',
      vite: '8.2.0',
    }
  );
  assert.equal(rootPackage.pnpm?.overrides?.['body-parser'], '1.20.6');
  assert.equal(rootPackage.pnpm?.overrides?.['@tootallnate/once'], '2.0.1');
  assert.equal(rootPackage.pnpm?.overrides?.esbuild, '0.28.1');
  assert.equal(rootPackage.pnpm?.overrides?.['@electron/packager'], '18.4.4');
  assert.equal(
    rootPackage.pnpm?.overrides?.['extract-zip'],
    'npm:@electron-internal/extract-zip@1.0.5'
  );
  assert.match(lockfile, /^lockfileVersion: '9\.0'$/m);
  assert.match(lockfile, /^  apps\/desktop:$/m);
  for (const vulnerablePackage of [
    '@babel/core@7.29.0',
    '@tootallnate/once@2.0.0',
    'body-parser@1.20.4',
    'electron@30.5.1',
    'esbuild@0.27.4',
    'extract-zip@2.0.1',
    'xlsx@0.18.5',
  ]) {
    assert.equal(
      lockfile.includes(vulnerablePackage),
      false,
      `Vulnerable dependency version must not re-enter the lockfile: ${vulnerablePackage}`
    );
  }

  for (const workflow of [ciWorkflow, releaseWorkflow]) {
    assert.match(workflow, /cache-dependency-path: pnpm-lock\.yaml/);
    assert.match(workflow, /pnpm install --frozen-lockfile/);
    assert.doesNotMatch(workflow, /cache-dependency-path: apps\/desktop\/package\.json/);
  }

  assert.match(ciWorkflow, /^permissions:\n  contents: read$/m);
  assert.match(ciWorkflow, /pnpm run test:repo/);
  assert.match(packageWindowsScript, /pnpm install --frozen-lockfile/);
  assert.doesNotMatch(packageWindowsScript, /Invoke-NativeStep "pnpm install" \{ pnpm install \}/);
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

  assert.match(ciWorkflow, /pnpm-lock\.yaml/);
  assert.match(ciWorkflow, /tooling\/scripts\/build-windows\.ps1/);
  assert.match(ciWorkflow, /tooling\/build\/prepare-desktop-release\.ps1/);
  assert.match(ciWorkflow, /apps\/desktop\/out\/\*\*\/\*\.zip/);

  assert.match(releaseWorkflow, /tooling\/scripts\/release-metadata\.mjs/);
  assert.match(releaseWorkflow, /tooling\/scripts\/package-windows\.ps1/);
  assert.match(releaseWorkflow, /apps\/desktop\/out\/\*\*\/\*\.zip/);
  assert.doesNotMatch(releaseWorkflow, /apps\/desktop\/out\/make\/squirrel\.windows/);
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

test('release note bodies omit top-level titles because the release page already provides one', () => {
  const releaseNotesDir = path.join(repoRoot, 'docs', 'release-notes');
  const releaseNotesFiles = fs.readdirSync(releaseNotesDir).filter((entry) => entry.endsWith('.md'));

  assert.ok(releaseNotesFiles.length > 0, 'expected release note markdown files to exist');

  for (const fileName of releaseNotesFiles) {
    const content = fs.readFileSync(path.join(releaseNotesDir, fileName), 'utf8');

    assert.doesNotMatch(content, /^#\s+/m, `did not expect top-level markdown titles in ${fileName}`);
    assert.match(content, /^##\s+/m, `expected section headings in ${fileName}`);
  }
});
