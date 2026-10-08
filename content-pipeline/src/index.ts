// Public API of @pratapai/content-pipeline.
// The Next.js layer (app/content) imports ONLY from here.

// runtime
export { buildContext, getContext } from './context.ts'; // buildContext: scripts/run.ts

// orchestration
export { runModule, runModules } from './modules/orchestrator.ts';
export { MODULES, getModule } from './modules/registry.ts';

// services (what the dashboard/API call)
export { getSystemHealth, getRunHistory, getActivity, getActions, logAction } from './services/health-service.ts';
export { getPipelineBoard } from './services/pipeline-service.ts';
export { listTodos, createTodo, updateTodo, deleteTodo } from './services/todo-service.ts';
export { applyApprovalDecision } from './services/approval-service.ts';
export {
  exportDataset, recordHumanLabel, getTrainingOverview,
  type TrainingExample, type TrainingOverview,
} from './services/dataset-service.ts';
export {
  getOperatorConsole, addSignal, decideTopic,
  type OperatorConsole, type TopicDecision,
} from './services/console-service.ts';

export {
  getIdeaBoard, getItemDetail, editItemCopy, planItem, getCalendar,
  type IdeaBoard, type IdeaCard, type CalendarData,
} from './services/board-service.ts';
export { getToday, type Today, type TodayAction } from './services/today-service.ts';
export {
  getAnalytics, recordMetrics, ANALYTICS_RANGES,
  type Analytics, type AnalyticsRange, type Breakdown, type FormatStat,
} from './services/analytics-service.ts';

export {
  listCompetitors, saveCompetitor, deleteCompetitor, getDecodeView, getDecodeRun, startDecode, stopDecode,
  type CompetitorRow, type DecodeRunRow, type DecodeFormatRow, type DecodedPostRow, type DecodeView,
} from './services/decode-service.ts';
export { listHooks, type HookRow } from './services/hook-service.ts';
export {
  listStyles, getStyleImage, renameStyle, deleteStyle, previewStyle,
  type StyleRow, type LayoutSpec,
} from './services/style-service.ts';
export { PLACEMENTS, isPlacement, toPdf } from './creative.ts';
export { uploadItemAssets, removeItemAssets, listItemAssets, getItemAsset } from './services/asset-service.ts';
export { EDITABLE_STATUSES } from '../core/src/index.ts';
export {
  loadBrand, readBrand, saveBrand, listFonts, uploadFont, deleteFont, setLogo, getLogo, EMPTY_BRAND,
  type BrandPatch, type FontRow,
} from './services/brand-service.ts';
export { brand, pillarSlugs, type Brand } from './brand.ts';
export { CURATED_FONTS } from './fonts.ts';
export { DECODE_PLATFORMS, type DecodePlatform } from './adapters/apify.ts';

// Entry points that spend money, tagged for the cost ledger (feature, and ref = the id argument).
// A paid call outside every scope is logged 'untagged' and shows red on the Costs page.
import { costScoped } from './cost-ledger.ts';
import { seedQcExamples as seedQc } from './services/dataset-service.ts';
import { useDecode as use_, stealFormat as steal } from './services/decode-service.ts';
import { rewriteWithHook as rewrite } from './services/hook-service.ts';
import { createStyle as create, generateCreative as generate, draftCarousel as carousel, remakeTemplate as remake } from './services/style-service.ts';
import { saveItemCreative as itemCreative } from './services/asset-service.ts';
import { extractVoice as voice, importOwnPosts as importOwn } from './services/brand-service.ts';
export const seedQcExamples = costScoped('qc_seed', seedQc);
export const useDecode = costScoped('decode_use', use_);
export const stealFormat = costScoped('steal_format', steal);
export const rewriteWithHook = costScoped('hook_rewrite', rewrite, 'content_item');
export const createStyle = costScoped('style_analyze', create);
export const generateCreative = costScoped('style_generate', generate);
export const draftCarousel = costScoped('style_draft', carousel);
export const remakeTemplate = costScoped('style_template', remake, 'style_ref');
export const saveItemCreative = costScoped('style_generate', itemCreative, 'content_item');
export const extractVoice = costScoped('brand_voice', voice);
export const importOwnPosts = costScoped('brand_import', importOwn);
import { topicAngles as angles_ } from './modules/draft-generator.module.ts';
export const topicAngles = costScoped('angles', angles_, 'topic');
export { pickAngle } from './modules/draft-generator.module.ts';
export { applyHookOption, hookPatternWeights, type HookOption, type PatternWeight } from './services/hook-service.ts';
export { HOOK_PATTERNS, type HookPattern } from './hook-patterns.ts';
export { listScripts, markFilmed, markUploaded, type ScriptRow, type ScriptStage } from './services/scripts-service.ts';
export { listVideos, type VideoRow, type TranscriptState } from './services/videos-service.ts';
import { transcribeVideo as transcribe_ } from './services/videos-service.ts';
export const transcribeVideo = costScoped('transcribe', transcribe_, 'decoded_post');
export { withCostScope } from './cost-ledger.ts';
export { getCosts, costsCsv, COST_RANGES, type Costs, type CostRange } from './services/cost-service.ts';

// row types the dashboard renders
export type { ContentItemRow, TopicRow, Angle } from './db/repo.ts';
export type { HealthReport } from './health.ts';
