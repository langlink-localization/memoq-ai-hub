import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  ssr: {
    noExternal: true,
  },
  build: {
    rollupOptions: {
      input: {
        'asset/assetBriefParser': path.resolve(__dirname, 'src/asset/assetBriefParser.js'),
        'asset/assetContext': path.resolve(__dirname, 'src/asset/assetContext.js'),
        'asset/assetContextAssembler': path.resolve(__dirname, 'src/asset/assetContextAssembler.js'),
        'asset/assetGlossaryParser': path.resolve(__dirname, 'src/asset/assetGlossaryParser.js'),
        'asset/assetParseCache': path.resolve(__dirname, 'src/asset/assetParseCache.js'),
        'asset/assetPreviewBuilder': path.resolve(__dirname, 'src/asset/assetPreviewBuilder.js'),
        'asset/assetRules': path.resolve(__dirname, 'src/asset/assetRules.js'),
        'asset/assetTbStructure': path.resolve(__dirname, 'src/asset/assetTbStructure.js'),
        'asset/assetTerminology': path.resolve(__dirname, 'src/asset/assetTerminology.js'),
        backgroundWorker: path.resolve(__dirname, 'src/backgroundWorker.js'),
        main: path.resolve(__dirname, 'src/main.js'),
        'runtime/runtime': path.resolve(__dirname, 'src/runtime/runtime.js'),
        'runtime/runtimeHistory': path.resolve(__dirname, 'src/runtime/runtimeHistory.js'),
        'runtime/runtimeHistoryBuilder': path.resolve(__dirname, 'src/runtime/runtimeHistoryBuilder.js'),
        'runtime/runtimePersistence': path.resolve(__dirname, 'src/runtime/runtimePersistence.js'),
        'runtime/runtimePreviewPolicy': path.resolve(__dirname, 'src/runtime/runtimePreviewPolicy.js'),
        'runtime/runtimeRuleEngine': path.resolve(__dirname, 'src/runtime/runtimeRuleEngine.js'),
        'runtime/runtimeState': path.resolve(__dirname, 'src/runtime/runtimeState.js'),
        'runtime/runtimeTranslationSupport': path.resolve(__dirname, 'src/runtime/runtimeTranslationSupport.js'),
        'shared/promptTemplate': path.resolve(__dirname, 'src/shared/promptTemplate.js'),
        'provider/providerGovernance': path.resolve(__dirname, 'src/provider/providerGovernance.js'),
        'provider/providerPromptBuilder': path.resolve(__dirname, 'src/provider/providerPromptBuilder.js'),
        'provider/providerConfig': path.resolve(__dirname, 'src/provider/providerConfig.js'),
        'provider/providerRegistry': path.resolve(__dirname, 'src/provider/providerRegistry.js'),
        'provider/providerResponseUtils': path.resolve(__dirname, 'src/provider/providerResponseUtils.js'),
        server: path.resolve(__dirname, 'src/server.js'),
        'shared/desktopContract': path.resolve(__dirname, 'src/shared/desktopContract.js'),
        'shared/desktopMetadata': path.resolve(__dirname, 'src/shared/desktopMetadata.js'),
        database: path.resolve(__dirname, 'src/database.js'),
        'integration/integrationService': path.resolve(__dirname, 'src/integration/integrationService.js'),
        'shared/memoqMetadata': path.resolve(__dirname, 'src/shared/memoqMetadata.js'),
        'shared/memoqMetadataNormalizer': path.resolve(__dirname, 'src/shared/memoqMetadataNormalizer.js'),
        'shared/paths': path.resolve(__dirname, 'src/shared/paths.js'),
        'preview/previewContext': path.resolve(__dirname, 'src/preview/previewContext.js'),
        'preview/previewContextClient': path.resolve(__dirname, 'src/preview/previewContextClient.js'),
        secretStore: path.resolve(__dirname, 'src/secretStore.js'),
        'shared/timeFormatting': path.resolve(__dirname, 'src/shared/timeFormatting.js'),
        workerLaunch: path.resolve(__dirname, 'src/workerLaunch.js')
      },
      external: ['electron', ...builtinModules, ...builtinModules.map((moduleName) => `node:${moduleName}`)],
    },
  },
});
