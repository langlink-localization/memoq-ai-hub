// Domain shapes shared by the desktop runtime boundary. Index signatures keep
// these objects assignable to the existing Record<string, any> persistence
// annotations while naming the fields the services actually read and write.

export interface RuntimeAssetBinding {
  assetId?: string;
  purpose?: string;
  [key: string]: any;
}

export interface RuntimeAsset {
  id: string;
  type?: string;
  name?: string;
  fileName?: string;
  storedPath?: string;
  fileSize?: number;
  sha256?: string;
  createdAt?: string;
  [key: string]: any;
}

export interface RuntimeProviderModel {
  id: string;
  modelName?: string;
  enabled?: boolean;
  [key: string]: any;
}

export interface RuntimeProvider {
  id: string;
  name?: string;
  type?: string;
  secretRef: string;
  enabled?: boolean;
  status?: string;
  models?: RuntimeProviderModel[];
  defaultModelId?: string;
  apiKey?: string;
  requestPath?: string;
  baseUrl?: string;
  [key: string]: any;
}

export interface RuntimeProfile {
  id: string;
  name: string;
  providerId?: string;
  assetBindings?: Array<RuntimeAssetBinding | null>;
  translationStyle?: string;
  promptTemplates?: any;
  assistantAdditionalInstruction?: string;
  usePreviewTargetText?: boolean;
  [key: string]: any;
}

export interface RuntimeMappingRule {
  id?: string;
  profileId?: string;
  priority?: number;
  [key: string]: any;
}

export interface RuntimeState {
  profiles: RuntimeProfile[];
  providers: RuntimeProvider[];
  assets: RuntimeAsset[];
  defaultProfileId?: string;
  mappingRules: RuntimeMappingRule[];
  promptPresets: any[];
  integrationPreferences?: Record<string, any>;
  [key: string]: any;
}

export interface RuntimeSecretStore {
  has(secretRef: string): boolean;
  get(secretRef: string): Promise<unknown> | unknown;
  set(secretRef: string, value: string): unknown;
  delete(secretRef: string): unknown;
}

export interface RuntimeProviderRegistry {
  testConnection(input: any): Promise<any>;
  discoverModels(input: any): Promise<any>;
  generateText?(input: any): Promise<any>;
  checkQuality?(input: any): Promise<any>;
}

export interface RuntimeProviderStatus {
  begin(provider: { id: string }): { id: string; fingerprint: string };
  release(token: { id: string; fingerprint: string } | undefined): void;
  apply(state: RuntimeState, token: { id: string; fingerprint: string } | undefined, patch: Record<string, unknown>): boolean;
  invalidate(id: string): boolean;
}

export interface PreviewSummaryRequest {
  route?: { provider?: RuntimeProvider; model: RuntimeProviderModel } | null;
  secret?: unknown;
  documentName?: string;
  documentId?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  fullText?: string;
}

export interface ResolvePreviewContextsRequest {
  state: RuntimeState;
  routes: any;
  profile: RuntimeProfile;
  payload: any;
  normalizedMetadata: any;
  incomingSegments: any[];
}

export interface RuntimePersistence {
  loadConfigState(): RuntimeState;
  saveConfigState(state: RuntimeState): RuntimeState;
  migrateLegacyState(): void;
  getHistoryOverview(): { count: number; latest: { requestId: string; status: string } | null };
  listHistory(): any[];
  getHistoryEntry(entryId: any): any;
  deleteHistoryEntries(entryIds?: any[]): { deletedCount: number };
  readTranslationCache(key: unknown): any;
  writeTranslationCache(key: unknown, text: unknown, updatedAt?: unknown): any;
  clearTranslationCache(): any;
  readDocumentSummaryCache(key: unknown): any;
  writeDocumentSummaryCache(key: unknown, text: unknown, updatedAt?: unknown): any;
  [key: string]: any;
}

export interface AssetServiceDependencies {
  loadState: () => RuntimeState;
  saveState: (state: RuntimeState) => unknown;
  assetsDir: string;
  parsedAssetCache: Map<string, unknown>;
  createId: (prefix: string) => string;
  nowIso: () => string;
}

export interface ProfileServiceDependencies {
  loadState: () => RuntimeState;
  saveState: (state: RuntimeState) => unknown;
  createId: (prefix: string) => string;
  onProfileDeleted?: (profileId: string) => void;
}

export interface ProviderServiceDependencies {
  loadState: () => RuntimeState;
  saveState: (state: RuntimeState) => unknown;
  loadHistoryEntries: () => any[];
  secretStore: RuntimeSecretStore;
  providerRegistry: RuntimeProviderRegistry;
  nowIso: () => string;
  providerStatus?: RuntimeProviderStatus;
}

export interface PreviewResolverDependencies {
  providerRegistry: RuntimeProviderRegistry;
  secretStore: RuntimeSecretStore;
  persistence: RuntimePersistence;
  previewContextClient?: {
    getStatus?: () => any;
    start?: () => void;
    dispose?: () => void;
    readDocument: (...args: any[]) => any;
    getContext: (...args: any[]) => any;
    readActiveDocument: (...args: any[]) => any;
  } | null;
  syncPreviewBridgeStatusFromClient: () => any;
  previewContextWaitMs: number;
  previewContextPollMs: number;
  nowIso: () => string;
}

export interface StateViewDependencies {
  loadState: () => RuntimeState;
  loadHistoryEntries: () => any[];
  getHistoryOverview: () => { count: number; latest: any };
  buildHistoryListItem: (entry: any) => any;
  secretStore: RuntimeSecretStore;
  syncPreviewBridgeStatusFromClient: () => any;
  updateService: { getStatus: () => any };
  isGatewayReady: () => boolean;
  bypassTranslationCacheProfileIds: Set<string>;
  paths: Record<string, any>;
}

export interface QaServiceDependencies {
  persistence: RuntimePersistence;
  loadState: () => RuntimeState;
  secretStore: RuntimeSecretStore;
  providerRegistry: RuntimeProviderRegistry;
  previewContextClient?: {
    getStatus?: () => any;
    readActiveDocument: (...args: any[]) => any;
  } | null;
  parsedAssetCache: Map<string, unknown>;
  performTranslation: (payload: any, ...rest: any[]) => Promise<any>;
  runtimeLogger: {
    info: (event: string, message: string, details?: any) => unknown;
    warn: (event: string, message: string, details?: any) => unknown;
    error?: (event: string, message: string, details?: any) => unknown;
  };
  nowIso: () => string;
  selectModel: (provider: any, ...rest: any[]) => any;
  hasSmartTbParsingCapability: (state: { providers?: RuntimeProvider[] }) => boolean;
  previewSettleMs?: number;
  previewSettleMaxWaits?: number;
}

export interface PreviewFocusedRange {
  startIndex?: number;
  length?: number;
  endIndex?: number;
  start?: number;
  end?: number;
  [key: string]: any;
}

// Flat preview-helper cache shape. previewContextClient clones raw helper
// JSON into this before matching, neighbor context, and feature projection.
export interface PreviewPartInput {
  previewPartId?: string;
  id?: string;
  sourceText?: string;
  source?: string;
  targetText?: string;
  target?: string;
  order?: number;
  sourceFocusedRange?: any;
  targetFocusedRange?: any;
  SourceFocusedRange?: any;
  TargetFocusedRange?: any;
  [key: string]: any;
}

export interface PreviewSegmentInput {
  index?: number;
  previewPartId?: string;
  sourceText?: string;
  source?: string;
  targetText?: string;
  target?: string;
  sourceFocusedRange?: any;
  targetFocusedRange?: any;
  SourceFocusedRange?: any;
  TargetFocusedRange?: any;
  [key: string]: any;
}

export interface PreviewPartSnapshot {
  previewPartId: string;
  sourceText: string;
  targetText: string;
  order: number;
  sourceFocusedRange?: PreviewFocusedRange | null;
  targetFocusedRange?: PreviewFocusedRange | null;
  [key: string]: any;
}

export interface PreviewSegment {
  index: number;
  previewPartId: string;
  sourceText: string;
  targetText: string;
  sourceFocusedRange?: PreviewFocusedRange | null;
  targetFocusedRange?: PreviewFocusedRange | null;
  [key: string]: any;
}

export interface PreviewDocumentCache {
  parts: PreviewPartSnapshot[];
  segments: PreviewSegment[];
  activePreviewPartIds: string[];
  currentRange?: PreviewFocusedRange | null;
  [key: string]: any;
}

export interface PreviewMatchOptions {
  parts?: PreviewPartSnapshot[];
  previewMatchMode?: string;
}

export interface PreviewContextQuery {
  documentId?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  segmentIndex?: number;
  segmentRange?: any;
  includeTargetText?: boolean;
  includeAboveContext?: boolean;
  includeBelowContext?: boolean;
  includeFullText?: boolean;
  includeSummary?: boolean;
  sourceText?: string;
  aboveOptions?: { maxSegments?: number; maxChars?: number; includeSource?: boolean; includeTarget?: boolean };
  belowOptions?: { maxSegments?: number; maxChars?: number; includeSource?: boolean; includeTarget?: boolean };
}

export interface PreviewFeatureRequest {
  includeFullText?: boolean;
  includeSummary?: boolean;
  includeTargetText?: boolean;
  includeAboveContext?: boolean;
  includeBelowContext?: boolean;
  [key: string]: any;
}

export interface DirectionalSegmentContext {
  segments: PreviewSegment[];
  anchorIndex: number;
  direction: number;
  maxSegments: number;
  maxChars: number;
  includeSource: boolean;
  includeTarget: boolean;
}

export interface DirectionalPartContext {
  parts: PreviewPartSnapshot[];
  anchorPosition: number;
  direction: number;
  maxSegments: number;
  maxChars: number;
  includeSource: boolean;
  includeTarget: boolean;
}

export interface PreviewClientOptions {
  appDataRoot?: string;
  logsDir?: string;
  helperExecutablePath?: string;
  repoRoot?: string;
}

export interface IntegrationInstallOptions {
  memoqVersion?: string;
  customInstallDir?: string;
  selectedInstallDir?: string;
  programDataDir?: string;
  [key: string]: any;
}

export interface AggregationServiceDependencies {
  settings?: Record<string, any>;
  runtimeLogger?: { info: (event: string, message: string, details?: any) => unknown };
  performTranslation: (payload: any) => Promise<any>;
  createId: (prefix: string) => string;
  buildSegmentMetadataIndex: (segments: any) => any;
  sleep?: (ms: number) => Promise<void>;
}
