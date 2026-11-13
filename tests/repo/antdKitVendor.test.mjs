import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const vendor = new URL('apps/desktop/vendor/', root);
const tarballName = 'langlink-tech-antd-kit-2.0.0-9f9ad210.tgz';
const provenance = JSON.parse(readFileSync(new URL('antd-kit-2.0.0-provenance.json', vendor), 'utf8'));
const tarball = readFileSync(new URL(tarballName, vendor));
const manifest = JSON.parse(readFileSync(new URL('apps/desktop/package.json', root), 'utf8'));
const lockfile = readFileSync(new URL('pnpm-lock.yaml', root), 'utf8');

test('vendored antd-kit exception pins source and cryptographic identity', () => {
  assert.equal(provenance.version, '2.0.0');
  assert.equal(provenance.sourceRepository, 'https://github.com/langlink-tech/antd-kit');
  assert.equal(provenance.sourceCommit, '9f9ad210939d46ca88cf8a02443e4d4c34a2afc1');
  assert.equal(createHash('sha256').update(tarball).digest('hex'), provenance.sha256);
  assert.equal(`sha512-${createHash('sha512').update(tarball).digest('base64')}`, provenance.integrity);
  assert.equal(manifest.dependencies['@langlink-tech/antd-kit'], `file:vendor/${tarballName}`);
  assert.ok(lockfile.includes(`integrity: ${provenance.integrity}`));
  assert.deepEqual(readdirSync(vendor).filter((name) => name.endsWith('.tgz')), [tarballName]);
});
