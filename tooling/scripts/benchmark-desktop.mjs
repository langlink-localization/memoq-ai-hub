import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..', '..');
const desktopRoot = path.join(repoRoot, 'apps', 'desktop');
const runtimePath = path.join(desktopRoot, 'src', 'runtime', 'runtime.js');
const defaultPackageDir = path.join(desktopRoot, 'out', 'memoQ AI Hub-win32-x64');
const defaultReleaseArchive = path.join(desktopRoot, 'out', 'memoq-ai-hub-win32-x64.7z');
const defaultRendererDir = path.join(desktopRoot, '.vite', 'renderer', 'main_window');

function toRepoRelativePath(targetPath) {
  return path.relative(repoRoot, targetPath).replaceAll(path.sep, '/');
}

function toMilliseconds(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

export function median(values) {
  const sorted = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!sorted.length) {
    return null;
  }
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function listFiles(rootDir, baseDir = rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }
  const files = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(entryPath, baseDir));
    } else if (entry.isFile()) {
      files.push({
        path: path.relative(baseDir, entryPath).replaceAll(path.sep, '/'),
        bytes: fs.statSync(entryPath).size
      });
    }
  }
  return files;
}

export function summarizeDirectory(rootDir, largestCount = 15) {
  const files = listFiles(rootDir);
  return {
    path: rootDir,
    exists: fs.existsSync(rootDir),
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
    largestFiles: [...files].sort((left, right) => right.bytes - left.bytes).slice(0, largestCount)
  };
}

export function validateBenchmarkArtifacts({ packageDir, releaseArchive, rendererDir }) {
  const problems = [];

  if (!fs.existsSync(packageDir) || !fs.statSync(packageDir).isDirectory()) {
    problems.push(`packaged desktop directory: ${packageDir}`);
  }
  if (!fs.existsSync(rendererDir) || !fs.statSync(rendererDir).isDirectory()) {
    problems.push(`renderer build directory: ${rendererDir}`);
  }
  if (!fs.existsSync(releaseArchive) || !fs.statSync(releaseArchive).isFile()) {
    problems.push(`compact release archive: ${releaseArchive}`);
  } else if (fs.statSync(releaseArchive).size === 0) {
    problems.push(`non-empty compact release archive: ${releaseArchive}`);
  }

  if (problems.length) {
    throw new Error(
      `Desktop benchmark prerequisites are missing:\n- ${problems.join('\n- ')}\n`
      + 'Run pnpm run package:desktop and pnpm run zip:desktop before benchmarking.'
    );
  }
}

async function measureRuntimeChild() {
  const rssBeforeLoad = process.memoryUsage().rss;
  const require = createRequire(import.meta.url);
  const loadStartedAt = process.hrtime.bigint();
  const { createRuntime } = require(runtimePath);
  const runtimeLoadMs = toMilliseconds(loadStartedAt);
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-ai-hub-benchmark-'));
  const initializationStartedAt = process.hrtime.bigint();
  let runtime;

  try {
    runtime = await createRuntime({ appDataRoot });
    runtime.getAppState();
    const runtimeInitializationMs = toMilliseconds(initializationStartedAt);
    const rssAfterInitialization = process.memoryUsage().rss;
    const heapAfterInitialization = process.memoryUsage().heapUsed;

    process.stdout.write(`${JSON.stringify({
      runtimeLoadMs,
      runtimeInitializationMs,
      runtimeStartupMs: runtimeLoadMs + runtimeInitializationMs,
      rssBeforeLoadBytes: rssBeforeLoad,
      rssAfterInitializationBytes: rssAfterInitialization,
      runtimeRssDeltaBytes: Math.max(0, rssAfterInitialization - rssBeforeLoad),
      heapAfterInitializationBytes: heapAfterInitialization,
      loadedModuleCount: Object.keys(require.cache).length
    })}\n`);
  } finally {
    runtime?.dispose?.();
    fs.rmSync(appDataRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

export function runRuntimeSamples(sampleCount = 7) {
  const samples = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const result = spawnSync(process.execPath, [scriptPath, '--runtime-child'], {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        NODE_ENV: 'production'
      }
    });
    if (result.status !== 0) {
      throw new Error(`Runtime benchmark child ${index + 1} failed:\n${result.stderr || result.stdout}`);
    }
    const lines = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean);
    samples.push(JSON.parse(lines.at(-1)));
  }

  return {
    sampleCount: samples.length,
    samples,
    medians: {
      runtimeLoadMs: median(samples.map((sample) => sample.runtimeLoadMs)),
      runtimeInitializationMs: median(samples.map((sample) => sample.runtimeInitializationMs)),
      runtimeStartupMs: median(samples.map((sample) => sample.runtimeStartupMs)),
      runtimeRssDeltaBytes: median(samples.map((sample) => sample.runtimeRssDeltaBytes)),
      rssAfterInitializationBytes: median(samples.map((sample) => sample.rssAfterInitializationBytes)),
      heapAfterInitializationBytes: median(samples.map((sample) => sample.heapAfterInitializationBytes)),
      loadedModuleCount: median(samples.map((sample) => sample.loadedModuleCount))
    }
  };
}

function getArgumentValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function buildReport() {
  const sampleCount = Number(getArgumentValue('--samples', '7'));
  const packageDir = path.resolve(getArgumentValue('--package-dir', defaultPackageDir));
  const releaseArchive = path.resolve(getArgumentValue('--release-archive', defaultReleaseArchive));
  const rendererDir = path.resolve(getArgumentValue('--renderer-dir', defaultRendererDir));
  validateBenchmarkArtifacts({ packageDir, releaseArchive, rendererDir });
  const packageSummary = summarizeDirectory(packageDir);
  const rendererSummary = summarizeDirectory(rendererDir);
  const asarPath = path.join(packageDir, 'resources', 'app.asar');

  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: os.cpus().map((cpu) => cpu.model),
      totalMemoryBytes: os.totalmem()
    },
    protocol: {
      runtimeSamples: sampleCount,
      runtimeIsolation: 'fresh child process per sample',
      externalProviderCalls: false,
      packageAcceptanceSurface: 'smallest complete portable archive produced by pnpm run zip:desktop'
    },
    runtime: runRuntimeSamples(sampleCount),
    package: {
      ...packageSummary,
      path: toRepoRelativePath(packageDir),
      asarBytes: fs.existsSync(asarPath) ? fs.statSync(asarPath).size : null,
      releaseArchive: {
        path: toRepoRelativePath(releaseArchive),
        exists: fs.existsSync(releaseArchive),
        bytes: fs.existsSync(releaseArchive) ? fs.statSync(releaseArchive).size : null
      }
    },
    renderer: {
      ...rendererSummary,
      path: toRepoRelativePath(rendererDir)
    }
  };
}

async function main() {
  if (process.argv.includes('--runtime-child')) {
    await measureRuntimeChild();
    return;
  }

  const report = buildReport();
  const outputPath = getArgumentValue('--output');
  if (outputPath) {
    const resolvedOutputPath = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
    fs.writeFileSync(resolvedOutputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  await main();
}
