// 「记一笔」预填（D-244 的扩展，原型，还没接进记一笔）；新记录表单的候选值（D-388）。
export {
  mergeCandidates,
  ruleCandidates,
  systemCandidates,
  type CandidateKind,
  type CandidateSource,
  type SystemMatch,
  type ValueCandidate,
} from './candidates';
export {
  findLayout,
  isLearned,
  learnLayout,
  LEARNED_HITS,
  matchLayout,
  type FieldHabit,
  type LayoutMemory,
  type LearnInput,
} from './memory';
export {
  prefillRecord,
  type PrefillBlock,
  type PrefillInput,
  type PrefillResult,
  type PrefillValue,
} from './prefill';
export { CONCEPTS, conceptOf, fieldTerms, type ConceptId, type ValueKind } from './concepts';
export {
  MAX_SUGGESTIONS,
  SUGGESTION_FLOOR,
  suggestValues,
  type FieldPick,
  type SuggestInput,
  type ValueSuggestion,
} from './rank';
export { pageOccurrences, type Occurrence, type TextBox, type TextPage } from './rows';
export {
  layoutCount,
  layoutStoreFile,
  LAYOUT_STORE_KEY,
  parseLayoutStore,
  parsePickStore,
  PICK_STORE_KEY,
  pickCount,
  putLayout,
  putPick,
  readLayoutStoreFile,
  readPickStoreFile,
  serializeLayoutStore,
  serializePickStore,
  type LayoutStore,
  type PickStore,
} from './store';
