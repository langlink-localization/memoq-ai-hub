const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { builtinModules, createRequire } = require('module');

const desktopNodeModulesPath = path.join(__dirname, 'node_modules');
const workspaceNodeModulesPath = path.join(__dirname, '..', '..', 'node_modules');
const sourceNodeModulesPath = fs.existsSync(desktopNodeModulesPath)
  ? desktopNodeModulesPath
  : workspaceNodeModulesPath;
const sqlWasmPath = path.join(sourceNodeModulesPath, 'sql.js', 'dist', 'sql-wasm.wasm');
const integrationDllSourcePath = path.join(__dirname, '..', '..', 'native', 'plugin', 'MemoQ.AI.Desktop.Plugin', 'bin', 'Release', 'net48', 'MemoQ.AI.Hub.Plugin.dll');
const integrationDllTargetPath = path.join(__dirname, 'build-resources', 'memoq-integration', 'MemoQ.AI.Hub.Plugin.dll');
const legacyIntegrationDllTargetPath = path.join(__dirname, 'build-resources', 'memoq-integration', 'MemoQ.AI.Desktop.Plugin.dll');
const clientDevConfigSourcePath = path.join(__dirname, '..', '..', 'docs', 'reference', 'ClientDevConfig.xml');
const previewHelperProjectPath = path.join(__dirname, '..', '..', 'native', 'preview-helper', 'MemoQ.AI.Preview.Helper', 'MemoQ.AI.Preview.Helper.csproj');
const previewHelperOutputDir = path.join(__dirname, '..', '..', 'native', 'preview-helper', 'MemoQ.AI.Preview.Helper', 'bin', 'forge', 'Release', 'net48');
const previewHelperOutputPath = path.join(previewHelperOutputDir, 'MemoQ.AI.Preview.Helper.exe');
const previewHelperIntermediatePath = path.join(__dirname, '..', '..', 'native', 'preview-helper', 'MemoQ.AI.Preview.Helper', 'obj', 'forge');
const previewHelperStagingDir = path.join(__dirname, 'helper');
const packagedOutputPath = path.join(__dirname, 'out');
const desktopContractPath = path.join(__dirname, '..', '..', 'packages', 'contracts', 'desktop-contract.json');
const sourceRuntimeDir = path.join(__dirname, 'src');
const packagedRuntimeDirRelative = path.join('.vite', 'build');
const buildRequire = createRequire(__filename);
const requiredElectronLocales = new Set(['en-US.pak', 'zh-CN.pak']);
const builtinModuleSet = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`)
]);
const packageRequirePattern = /require\((['"])([^'"]+)\1\)/g;

function readPackageJson(packageDir) {
  return JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
}

function safeRemoveDirectory(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return;
  }

  fs.rmSync(targetPath, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200
  });
}

function normalizePackageName(specifier) {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) {
    return '';
  }

  if (builtinModuleSet.has(specifier)) {
    return '';
  }

  if (specifier.startsWith('@')) {
    const segments = specifier.split('/');
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : '';
  }

  return specifier.split('/')[0];
}

function getJavaScriptFiles(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const results = [];

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      results.push(...getJavaScriptFiles(entryPath));
      continue;
    }

    if (entry.isFile() && path.extname(entry.name) === '.js') {
      results.push(entryPath);
    }
  }

  return results;
}

function findRuntimePackageNames(buildPath) {
  const runtimeFiles = getJavaScriptFiles(path.join(buildPath, packagedRuntimeDirRelative));

  const packageNames = new Set();

  for (const runtimeFile of runtimeFiles) {
    const fileContent = fs.readFileSync(runtimeFile, 'utf8');
    packageRequirePattern.lastIndex = 0;

    for (const match of fileContent.matchAll(packageRequirePattern)) {
      const packageName = normalizePackageName(match[2]);
      if (packageName) {
        packageNames.add(packageName);
      }
    }
  }

  return Array.from(packageNames).sort();
}

function resolvePackageDirectory(packageName) {
  const directPackagePath = path.join(sourceNodeModulesPath, packageName);
  if (fs.existsSync(directPackagePath)) {
    return fs.realpathSync(directPackagePath);
  }

  const resolvedEntryPath = buildRequire.resolve(packageName, {
    paths: [__dirname, sourceNodeModulesPath]
  });

  let currentDir = path.dirname(resolvedEntryPath);

  while (currentDir && currentDir !== path.dirname(currentDir)) {
    const packageJsonPath = path.join(currentDir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      if (packageJson.name === packageName) {
        return currentDir;
      }
    }

    currentDir = path.dirname(currentDir);
  }

  throw new Error(`Unable to locate package root for runtime dependency: ${packageName}`);
}

function getPackageDependencyNames(packageDir) {
  const packageJson = readPackageJson(packageDir);
  return Object.keys({
    ...(packageJson.dependencies || {}),
    ...(packageJson.optionalDependencies || {})
  })
    .map((dependencyName) => normalizePackageName(dependencyName))
    .filter(Boolean);
}

function collectRuntimePackageNames(buildPath) {
  const discoveredPackages = findRuntimePackageNames(buildPath);
  const pendingPackages = discoveredPackages.filter((packageName) => packageName !== 'electron');
  const collectedPackages = new Set();

  while (pendingPackages.length) {
    const packageName = pendingPackages.pop();
    if (!packageName || collectedPackages.has(packageName)) {
      continue;
    }

    collectedPackages.add(packageName);

    const packageDir = resolvePackageDirectory(packageName);
    const dependencyNames = getPackageDependencyNames(packageDir);

    for (const dependencyName of dependencyNames) {
      if (!collectedPackages.has(dependencyName)) {
        pendingPackages.push(dependencyName);
      }
    }
  }

  return Array.from(collectedPackages).sort();
}

function copyPackageDirectory(sourceDir, targetDir) {
  fs.cpSync(sourceDir, targetDir, {
    recursive: true,
    dereference: true,
    force: true,
    filter: (source) => {
      const relativePath = path.relative(sourceDir, source);
      if (!relativePath) {
        return true;
      }

      const segments = relativePath.split(path.sep);
      return !segments.includes('.bin') && !segments.includes('.vite-temp');
    }
  });
}

function copyRuntimeNodeModules(buildPath) {
  if (!fs.existsSync(sourceNodeModulesPath)) {
    throw new Error(`Node modules directory not found for packaging: ${sourceNodeModulesPath}`);
  }

  const targetNodeModulesPath = path.join(buildPath, 'node_modules');
  const runtimePackageNames = collectRuntimePackageNames(buildPath);

  safeRemoveDirectory(targetNodeModulesPath);
  fs.mkdirSync(targetNodeModulesPath, { recursive: true });

  for (const packageName of runtimePackageNames) {
    const sourcePackageDir = resolvePackageDirectory(packageName);
    const targetPackageDir = path.join(targetNodeModulesPath, packageName);
    fs.mkdirSync(path.dirname(targetPackageDir), { recursive: true });
    copyPackageDirectory(sourcePackageDir, targetPackageDir);
  }
}

function prunePackagedLocales(buildPath) {
  const localesDir = path.join(buildPath, 'locales');
  if (!fs.existsSync(localesDir)) {
    return;
  }

  for (const entry of fs.readdirSync(localesDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    if (!requiredElectronLocales.has(entry.name)) {
      fs.rmSync(path.join(localesDir, entry.name), { force: true });
    }
  }
}

function prunePackagedLocalesFromOutputs(outputPaths = []) {
  for (const outputPath of outputPaths) {
    prunePackagedLocales(outputPath);
  }
}

function copyMissingRuntimeModules(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) {
    return;
  }

  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyMissingRuntimeModules(sourcePath, targetPath);
      continue;
    }

    if (path.extname(entry.name) !== '.js') {
      continue;
    }

    if (!fs.existsSync(targetPath)) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function ensurePackagedRuntimeModules(buildPath) {
  copyMissingRuntimeModules(sourceRuntimeDir, path.join(buildPath, packagedRuntimeDirRelative));
}

module.exports = {
  outDir: packagedOutputPath,
  packagerConfig: {
    name: 'memoQ AI Hub',
    executableName: 'memoQ AI Hub',
    appBundleId: 'com.memoq.ai.desktop',
    asar: true,
    derefSymlinks: true,
    extraResource: [
      previewHelperStagingDir,
      desktopContractPath,
      clientDevConfigSourcePath,
      path.join(__dirname, 'build-resources', 'memoq-integration', 'MemoQ.AI.Hub.Plugin.dll'),
      sqlWasmPath
    ]
  },
  hooks: {
    prePackage: async () => {
      if (fs.existsSync(packagedOutputPath)) {
        try {
          safeRemoveDirectory(packagedOutputPath);
        } catch (error) {
          if (!error || (error.code !== 'EBUSY' && error.code !== 'EPERM')) {
            throw error;
          }
          console.warn(`Skipping cleanup for locked output directory: ${packagedOutputPath}`);
        }
      }

      if (fs.existsSync(legacyIntegrationDllTargetPath)) {
        fs.rmSync(legacyIntegrationDllTargetPath, { force: true });
      }

      if (fs.existsSync(previewHelperProjectPath)) {
        fs.mkdirSync(previewHelperStagingDir, { recursive: true });
        fs.mkdirSync(previewHelperIntermediatePath, { recursive: true });
        execFileSync('dotnet', [
          'build',
          previewHelperProjectPath,
          '-c',
          'Release',
          `-p:BaseIntermediateOutputPath=${previewHelperIntermediatePath}${path.sep}`,
          `-p:IntermediateOutputPath=${previewHelperIntermediatePath}${path.sep}`,
          `-p:OutputPath=${previewHelperOutputDir}${path.sep}`
        ], {
          cwd: path.dirname(previewHelperProjectPath),
          stdio: 'inherit'
        });

        if (!fs.existsSync(previewHelperOutputPath)) {
          throw new Error(`Preview helper EXE not found: ${previewHelperOutputPath}`);
        }

        fs.copyFileSync(previewHelperOutputPath, path.join(previewHelperStagingDir, 'MemoQ.AI.Preview.Helper.exe'));
      }

      if (fs.existsSync(integrationDllSourcePath)) {
        fs.mkdirSync(path.dirname(integrationDllTargetPath), { recursive: true });
        fs.copyFileSync(integrationDllSourcePath, integrationDllTargetPath);
      }
    },
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      copyRuntimeNodeModules(buildPath);
      ensurePackagedRuntimeModules(buildPath);
    },
    postPackage: async (_forgeConfig, options) => {
      prunePackagedLocalesFromOutputs(options?.outputPaths);
    }
  },
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32']
    }
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-vite',
      config: {
        build: [
          {
            entry: 'src/main.js',
            config: 'vite.main.config.mjs',
            target: 'main'
          },
          {
            entry: 'src/preload.js',
            config: 'vite.preload.config.mjs',
            target: 'preload'
          }
        ],
        renderer: [
          {
            name: 'main_window',
            config: 'vite.renderer.config.mjs'
          }
        ]
      }
    }
  ],
  __testables: {
    collectRuntimePackageNames,
    findRuntimePackageNames,
    getPackageDependencyNames,
    normalizePackageName,
    resolvePackageDirectory
  }
};
