// Public API of @pratapai/content-pipeline.
// The Next.js layer (app/content) imports ONLY from here.

// runtime
export { buildContext, getContext } from './context.ts';
export { loadEnv, type ContentEnv } from './env.ts';
export type { ModuleContext, Module, ModuleResult, RunStatus } from './modules/module.ts';

// orchestration
export { runModule, runModules, type RunRecord } from './modules/orchestrator.ts';
export { MODULES, getModule } from './modules/registry.ts';

// services (what the dashboard/API call)
export { getSystemHealth, getRunHistory, getActivity, type SystemHealth, type ModuleHealth } from './services/health-service.ts';
export { getPipelineBoard, type PipelineBoard } from './services/pipeline-service.ts';
export {
  listTodos, createTodo, updateTodo, deleteTodo,
  type NewTodo, type TodoPatch,
} from './services/todo-service.ts';
export {
  applyApprovalDecision,
  type ApplyDecisionInput, type ApplyDecisionResult,
} from './services/approval-service.ts';
export {
  exportDataset, recordHumanLabel, toExample, getTrainingOverview, seedQcExamples,
  type TrainingExample, type TrainingOverview,
} from './services/dataset-service.ts';
export {
  getOperatorConsole, addSignal, decideTopic,
  type OperatorConsole, type ApprovalQueueItem, type AddSignalInput, type TopicDecision,
} from './services/console-service.ts';
export {
  getContentOverview,
  type ContentOverview, type ContentOverview as Overview,
  type FunnelStage, type PillarMix, type OverviewTotals,
} from './services/overview-service.ts';

export {
  getIdeaBoard, getItemDetail, editItemCopy, planItem, getCalendar, groupIdeas,
  type IdeaBoard, type IdeaCard, type IdeaPiece, type ItemDetail, type CalendarData,
} from './services/board-service.ts';
export { getToday, type Today, type TodayAction, type UpNextRow } from './services/today-service.ts';
export {
  getAnalytics, getOwnResults, recordMetrics, ANALYTICS_RANGES,
  type Analytics, type AnalyticsRange, type Breakdown, type MetricsInput, type FormatStat, type OwnResults,
} from './services/analytics-service.ts';

export {
  listCompetitors, saveCompetitor, deleteCompetitor, getDecodeView, getDecodeRun, startDecode, stopDecode, useDecode, stealFormat, BEAT_TAGS,
  type CompetitorRow, type DecodeRunRow, type DecodeFormatRow, type DecodedPostRow, type DecodeView, type Beat, type BeatTag,
} from './services/decode-service.ts';
export { listHooks, rewriteWithHook, type HookRow } from './services/hook-service.ts';
export {
  createStyle, listStyles, getStyleImage, renameStyle, deleteStyle, generateCreative, draftCarousel, previewStyle, remakeTemplate,
  type StyleRow, type StyleSpec, type TextZone, type GenerateInput, type GenerateResult, type LayoutSpec, type SlideKind,
} from './services/style-service.ts';
export { PLACEMENTS, isPlacement, toPdf, type Placement, type Look } from './creative.ts';
export {
  saveItemCreative, uploadItemAssets, removeItemAssets, listItemAssets, getItemAsset, EDITABLE_STATUSES,
  type AssetInfo,
} from './services/asset-service.ts';
export {
  loadBrand, readBrand, saveBrand, extractVoice, importOwnPosts, listFonts, uploadFont, deleteFont, setLogo, getLogo, EMPTY_BRAND,
  type BrandPatch, type FontRow,
} from './services/brand-service.ts';
export { brand, pillarSlugs, DEFAULT_BRAND, type Brand, type BrandPillar, type BrandOffer, type LogoCorner } from './brand.ts';
export { CURATED_FONTS } from './fonts.ts';
export { DECODE_PLATFORMS, type DecodePlatform } from './adapters/apify.ts';

// row types the dashboard renders
export type {
  ContentItemRow, ClaimRow, TopicRow, ResearchInputRow,
  PerformanceRow, ApprovalLogRow, SeriesRow, ActivityRow, ModuleHealthRow, TodoRow,
} from './db/repo.ts';

// health vocabulary
export { type HealthReport, type HealthState } from './health.ts';

// re-export the tested core for convenience
export * as core from '../core/src/index.ts';
