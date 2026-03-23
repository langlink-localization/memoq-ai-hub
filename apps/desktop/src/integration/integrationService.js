const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { INTEGRATION, ERROR_CODES } = require('../shared/desktopContract');

class IntegrationError extends Error {
  constructor(message, code, statusCode = 500) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

const SUPPORTED_MEMOQ_VERSIONS = ['10', '11', '12'];

function normalizeVersion(version) {
  const normalized = String(version || '').trim();
  return SUPPORTED_MEMOQ_VERSIONS.includes(normalized) ? normalized : '11';
}

function defaultMemoQRootDir(version) {
  return path.join('C:\\Program Files', 'memoQ', `memoQ-${normalizeVersion(version)}`);
}

function buildDefaultMemoQInstallOptions(preferredVersion) {
  return SUPPORTED_MEMOQ_VERSIONS.map((version) => {
    const rootDir = defaultMemoQRootDir(version);
    return {
      key: `default-${version}`,
      type: 'default',
      version,
      label: `memoQ ${version}`,
      rootDir,
      exists: fs.existsSync(path.join(rootDir, 'Addins'))
    };
  }).sort((left, right) => {
    if (left.version === preferredVersion) return -1;
    if (right.version === preferredVersion) return 1;
    return Number(right.version) - Number(left.version);
  });
}

function buildMemoQRootCandidates(options = {}) {
  const preferredVersion = normalizeVersion(options.memoqVersion);
  const customInstallDir = String(options.customInstallDir || '').trim();
  const candidates = [];
  const seen = new Set();

  function pushCandidate(rootDir) {
    const value = String(rootDir || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    candidates.push(value);
  }

  if (customInstallDir) {
    pushCandidate(customInstallDir);
  }

  pushCandidate(defaultMemoQRootDir(preferredVersion));
  SUPPORTED_MEMOQ_VERSIONS
    .filter((item) => item !== preferredVersion)
    .forEach((item) => pushCandidate(defaultMemoQRootDir(item)));

  return candidates;
}

function findMemoQDesktopInstallations(options = {}) {
  const rootCandidates = buildMemoQRootCandidates(options);
  return rootCandidates
    .filter((rootDir) => fs.existsSync(path.join(rootDir, 'Addins')))
    .map((rootDir) => ({
      rootDir,
      addinsDir: path.join(rootDir, 'Addins'),
      name: path.basename(rootDir)
    }));
}

function resolveClientDevConfigTarget(options = {}) {
  const programDataDir = String(options.programDataDir || process.env.ProgramData || 'C:\\ProgramData').trim();
  if (!programDataDir) {
    throw new IntegrationError(
      'ProgramData is required to install ClientDevConfig.xml.',
      ERROR_CODES.integrationNotInstalled,
      500
    );
  }

  const configuredRootDir = String(INTEGRATION.clientDevConfigRootDir || '').trim();
  const targetRoot = configuredRootDir
    ? (path.isAbsolute(configuredRootDir)
      ? configuredRootDir
      : path.join(programDataDir, configuredRootDir))
    : path.join(programDataDir, INTEGRATION.clientDevConfigVendorDir || 'MemoQ');

  return path.join(targetRoot, INTEGRATION.clientDevConfigName);
}

function resolveIntegrationAssets(paths) {
  const packagedResourcesRoot = String(process.resourcesPath || '').trim();
  const candidates = {
    pluginDll: [
      packagedResourcesRoot ? path.join(packagedResourcesRoot, INTEGRATION.pluginDllName) : '',
      packagedResourcesRoot ? path.join(packagedResourcesRoot, 'memoq-integration', INTEGRATION.pluginDllName) : '',
      path.join(paths.repoRoot, 'native', 'plugin', 'MemoQ.AI.Desktop.Plugin', 'bin', 'Release', 'net48', INTEGRATION.pluginDllName),
      path.join(paths.repoRoot, 'apps', 'desktop', 'build-resources', 'memoq-integration', INTEGRATION.pluginDllName)
    ],
    clientDevConfig: [
      packagedResourcesRoot ? path.join(packagedResourcesRoot, INTEGRATION.clientDevConfigName) : '',
      packagedResourcesRoot ? path.join(packagedResourcesRoot, 'memoq-integration', INTEGRATION.clientDevConfigName) : '',
      path.join(paths.repoRoot, 'apps', 'desktop', 'build-resources', 'memoq-integration', INTEGRATION.clientDevConfigName),
      path.join(paths.repoRoot, 'docs', 'reference', INTEGRATION.clientDevConfigName)
    ]
  };

  const pluginDll = candidates.pluginDll.find((candidate) => fs.existsSync(candidate)) || '';
  const clientDevConfig = candidates.clientDevConfig.find((candidate) => fs.existsSync(candidate)) || '';

  return {
    pluginDll,
    clientDevConfig,
    pluginDllExists: Boolean(pluginDll),
    clientDevConfigExists: Boolean(clientDevConfig)
  };
}

function applyFsOperationWithAccessErrorMapping(operation, target) {
  try {
    operation();
  } catch (error) {
    if (error && (error.code === 'EACCES' || error.code === 'EPERM')) {
      throw new IntegrationError(
        `Writing ${target} requires elevated Windows permissions.`,
        ERROR_CODES.installRequiresElevation,
        403
      );
    }
    throw error;
  }
}

function buildElevatedInstallScript(steps) {
  const lines = ['$ErrorActionPreference = "Stop"'];
  for (const step of steps) {
    if (step.action === 'remove') {
      lines.push(`if (Test-Path -LiteralPath '${String(step.target).replace(/'/g, "''")}') { Remove-Item -LiteralPath '${String(step.target).replace(/'/g, "''")}' -Force }`);
      continue;
    }

    lines.push(`New-Item -ItemType Directory -Force -Path '${String(path.dirname(step.target)).replace(/'/g, "''")}' | Out-Null`);
    lines.push(`Copy-Item -LiteralPath '${String(step.source).replace(/'/g, "''")}' -Destination '${String(step.target).replace(/'/g, "''")}' -Force`);
  }
  return lines.join('; ');
}

function decodeSpawnOutput(value) {
  if (Buffer.isBuffer(value)) {
    return value.toString('utf8').trim();
  }
  return String(value || '').trim();
}

function truncateDiagnosticOutput(value, maxLength = 400) {
  const normalized = decodeSpawnOutput(value);
  if (!normalized) {
    return '';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

function formatElevatedInstallDiagnostics(result = {}) {
  const stdout = truncateDiagnosticOutput(result.stdout);
  const stderr = truncateDiagnosticOutput(result.stderr);
  const details = [];
  if (stdout) {
    details.push(`stdout: ${stdout}`);
  }
  if (stderr) {
    details.push(`stderr: ${stderr}`);
  }
  return details.length ? ` ${details.join(' | ')}` : '';
}

function runElevatedInstall(steps) {
  const powershellExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const encodedCommand = Buffer.from(buildElevatedInstallScript(steps), 'utf16le').toString('base64');
  const launcherScript = [
    '$process = Start-Process',
    `-FilePath '${powershellExe.replace(/'/g, "''")}'`,
    '-Verb RunAs',
    '-Wait',
    '-PassThru',
    `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encodedCommand}')`,
    ';',
    'exit $process.ExitCode'
  ].join(' ');

  const result = spawnSync(powershellExe, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', launcherScript], {
    windowsHide: true,
    stdio: 'pipe'
  });
  const diagnostics = formatElevatedInstallDiagnostics(result);

  if (result.status !== 0) {
    throw new IntegrationError(
      result.status === 1
        ? `Administrator approval was canceled before the memoQ integration could be installed.${diagnostics}`
        : `Elevated memoQ integration install failed with exit code ${result.status}.${diagnostics}`,
      ERROR_CODES.installRequiresElevation,
      403
    );
  }
}

function getIntegrationStatus(paths, integrationConfig = {}) {
  const requestedMemoQVersion = normalizeVersion(integrationConfig.memoqVersion);
  const customInstallDir = String(integrationConfig.customInstallDir || '').trim();
  const selectedInstallDir = String(integrationConfig.selectedInstallDir || customInstallDir || '').trim();
  const installations = findMemoQDesktopInstallations({
    ...integrationConfig,
    memoqVersion: requestedMemoQVersion,
    customInstallDir: customInstallDir || selectedInstallDir
  });
  const assets = resolveIntegrationAssets(paths);
  const clientDevConfigTarget = resolveClientDevConfigTarget({ programDataDir: process.env.ProgramData });
  const defaultInstallOptions = buildDefaultMemoQInstallOptions(requestedMemoQVersion);
  const resolvedSelectedInstallDir = selectedInstallDir
    || installations[0]?.rootDir
    || defaultMemoQRootDir(requestedMemoQVersion);

  const enrichedInstallations = installations.map((installation) => {
    const pluginTarget = path.join(installation.addinsDir, INTEGRATION.pluginDllName);
    const legacyPluginTarget = path.join(installation.addinsDir, 'MemoQ.AI.Desktop.Plugin.dll');
    const pluginInstalled = fs.existsSync(pluginTarget);
    const legacyPluginInstalled = fs.existsSync(legacyPluginTarget);
    const clientDevConfigInstalled = fs.existsSync(clientDevConfigTarget);
    let status = 'not_installed';
    if (pluginInstalled && clientDevConfigInstalled && !legacyPluginInstalled) {
      status = 'installed';
    } else if (pluginInstalled || clientDevConfigInstalled || legacyPluginInstalled) {
      status = 'needs_repair';
    }

    return {
      ...installation,
      pluginTarget,
      pluginInstalled,
      legacyPluginTarget,
      legacyPluginInstalled,
      clientDevConfigTarget,
      clientDevConfigInstalled,
      status
    };
  });

  return {
    status: enrichedInstallations.some((item) => item.status === 'installed')
      ? 'installed'
      : enrichedInstallations.some((item) => item.status === 'needs_repair')
        ? 'needs_repair'
        : (enrichedInstallations.length ? 'not_installed' : 'not_found'),
    requestedMemoQVersion,
    customInstallDir,
    selectedInstallDir: resolvedSelectedInstallDir,
    defaultInstallOptions,
    assets,
    clientDevConfigTarget,
    installations: enrichedInstallations
  };
}

function installIntegration(paths, integrationConfig = {}) {
  const status = getIntegrationStatus(paths, integrationConfig);
  const targetRoot = String(integrationConfig.selectedInstallDir || integrationConfig.customInstallDir || '').trim()
    || status.selectedInstallDir
    || status.installations[0]?.rootDir
    || defaultMemoQRootDir(integrationConfig.memoqVersion);
  const targetAddinsDir = path.join(targetRoot, 'Addins');
  const legacyPluginTarget = path.join(targetAddinsDir, 'MemoQ.AI.Desktop.Plugin.dll');

  if (!status.assets.pluginDllExists || !status.assets.clientDevConfigExists) {
    throw new IntegrationError(
      'Integration files were not found in the packaged resources or the local development build output.',
      ERROR_CODES.integrationNotInstalled,
      500
    );
  }

  const steps = [
    {
      action: 'remove',
      target: legacyPluginTarget
    },
    {
      action: 'copy',
      source: status.assets.pluginDll,
      target: path.join(targetAddinsDir, INTEGRATION.pluginDllName)
    },
    {
      action: 'copy',
      source: status.assets.clientDevConfig,
      target: status.clientDevConfigTarget
    }
  ];

  try {
    steps.forEach((step) => {
      if (step.action === 'remove') {
        applyFsOperationWithAccessErrorMapping(() => {
          if (fs.existsSync(step.target)) {
            fs.rmSync(step.target, { force: true });
          }
        }, step.target);
        return;
      }

      applyFsOperationWithAccessErrorMapping(() => {
        fs.mkdirSync(path.dirname(step.target), { recursive: true });
        fs.copyFileSync(step.source, step.target);
      }, step.target);
    });
  } catch (error) {
    if (error instanceof IntegrationError && error.code === ERROR_CODES.installRequiresElevation) {
      runElevatedInstall(steps);
    } else {
      throw error;
    }
  }

  return getIntegrationStatus(paths, {
    ...integrationConfig,
    customInstallDir: String(integrationConfig.customInstallDir || '').trim(),
    selectedInstallDir: targetRoot
  });
}

module.exports = {
  IntegrationError,
  getIntegrationStatus,
  installIntegration,
  findMemoQDesktopInstallations,
  buildMemoQRootCandidates,
  buildDefaultMemoQInstallOptions,
  resolveIntegrationAssets,
  resolveClientDevConfigTarget
};
