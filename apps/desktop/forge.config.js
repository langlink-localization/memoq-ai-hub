const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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

function copyRuntimeNodeModules(targetNodeModulesPath) {
  if (!fs.existsSync(sourceNodeModulesPath)) {
    throw new Error(`Node modules directory not found for packaging: ${sourceNodeModulesPath}`);
  }

  if (fs.existsSync(targetNodeModulesPath)) {
    fs.rmSync(targetNodeModulesPath, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200
    });
  }

  fs.cpSync(sourceNodeModulesPath, targetNodeModulesPath, {
    recursive: true,
    dereference: true,
    force: true,
    filter: (source) => {
      const relativePath = path.relative(sourceNodeModulesPath, source);
      if (!relativePath) {
        return true;
      }

      const segments = relativePath.split(path.sep);
      return !segments.includes('.bin') && !segments.includes('.vite-temp');
    }
  });
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
          fs.rmSync(packagedOutputPath, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 200
          });
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
      copyRuntimeNodeModules(path.join(buildPath, 'node_modules'));
      ensurePackagedRuntimeModules(buildPath);
    }
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        setupExe: 'memoQ-AI-Hub-Setup.exe',
        noMsi: true
      }
    },
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
  ]
};
