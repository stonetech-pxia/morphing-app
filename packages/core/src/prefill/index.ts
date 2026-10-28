// 「记一笔」预填（D-244 的扩展，原型，还没接进记一笔）。
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
export {
  layoutCount,
  layoutStoreFile,
  LAYOUT_STORE_KEY,
  parseLayoutStore,
  putLayout,
  readLayoutStoreFile,
  serializeLayoutStore,
  type LayoutStore,
} from './store';
