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
  learnLayout,
  LEARNED_HITS,
  type FieldHabit,
  type LayoutMemory,
  type LearnInput,
} from './memory';
export { prefillRecord, type PrefillInput, type PrefillResult, type PrefillValue } from './prefill';
