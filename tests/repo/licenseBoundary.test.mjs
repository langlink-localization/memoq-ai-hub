import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const removedMemoQSampleIconSha256 = 'f64e6a29e306553396fe09bf3e07d8614a90b9cb747d7d6e2c2a500ddcc5076a';

function readFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8').replace(/\r\n?/g, '\n');
}

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .map((entry) => entry.replaceAll('\\', '/'))
    .filter((entry) => fs.existsSync(path.join(repoRoot, entry)));
}

test('tracked files exclude vendored memoQ SDK material and restricted binaries', () => {
  const files = trackedFiles();
  const forbidden = files.filter((file) => (
    /^docs\/reference\/(?:memoQ-|Preview_SDK_)/i.test(file)
    || /^native\/plugin\/References\//i.test(file)
    || /(?:^|\/)(?:MemoQ\.Addins\.Common|MemoQ\.MTInterfaces|MemoQ\.AddinSigner|Kilgray\.[^/]+)\.(?:dll|exe)$/i.test(file)
    || /memoQ-(?:MT|QA|TB|TM)-SDK-[^/]+\.zip$/i.test(file)
  ));

  assert.deepEqual(forbidden, []);
});

test('plugin icon is not the removed memoQ Dummy MT SDK sample asset', () => {
  const iconPath = path.join(repoRoot, 'native', 'plugin', 'MemoQ.AI.Desktop.Plugin', 'Icon.bmp');
  const iconHash = crypto.createHash('sha256').update(fs.readFileSync(iconPath)).digest('hex');

  assert.notEqual(iconHash, removedMemoQSampleIconSha256);
  assert.equal(iconHash, '181c3dc29719cfcccba0366062eda16e745a1a9a5e5bed0741d97d6fcc307c71');
});

test('license scope and SDK resolver preserve the third-party boundary', () => {
  const licenseScope = readFile('LICENSE_SCOPE.md');
  const notices = readFile('THIRD_PARTY_NOTICES.md');
  const resolver = readFile('tooling/scripts/resolve-memoq-sdk.ps1');
  const regressionRunner = readFile('tooling/scripts/test-plugin-regression.ps1');
  const pluginProject = readFile('native/plugin/MemoQ.AI.Desktop.Plugin/MemoQ.AI.Desktop.Plugin.csproj');

  assert.match(licenseScope, /MIT license applies only/i);
  assert.match(licenseScope, /not an official memoQ product/i);
  assert.match(notices, /do not include `MemoQ\.Addins\.Common\.dll`/i);
  assert.match(resolver, /memoQ-MT-SDK-2\.4\.4\.zip/);
  assert.match(resolver, /FCB0E684CD15037E90D8B3B5C658501D9FF53C1FD35243D9739341F336D69386/);
  assert.doesNotMatch(resolver, /MemoQ\.AddinSigner/);
  assert.match(regressionRunner, /locally licensed memoQ installation/);
  assert.match(regressionRunner, /MEMOQ_RUNTIME_DIR/);
  assert.match(pluginProject, /<Private>false<\/Private>/g);
  assert.match(pluginProject, /\$\(MemoQSdkDir\)/);
  assert.doesNotMatch(pluginProject, /native\\plugin\\References|\.\.\\References/);
});

test('public release publishing fails closed without recorded owner risk acceptance', () => {
  const releaseWorkflow = readFile('.github/workflows/release.yml');

  assert.match(releaseWorkflow, /PUBLIC_RELEASE_RISK_ACCEPTED/);
  assert.match(releaseWorkflow, /Public release risk acceptance is not recorded/);
  assert.match(releaseWorkflow, /vars\.PUBLIC_RELEASE_RISK_ACCEPTED/);
  assert.match(releaseWorkflow, /without representing memoQ authorization/);
});
