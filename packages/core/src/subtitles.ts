import { tidyTranscript, type SpeechLanguage, type SpeechSegment } from './speech';

const stamp = (ms: number) => {
  const value = Math.max(0, Math.round(ms));
  const pad = (v: number, n = 2) => String(v).padStart(n, '0');
  return `${pad(Math.floor(value / 3600000))}:${pad(Math.floor(value / 60000) % 60)}:${pad(Math.floor(value / 1000) % 60)},${pad(value % 1000, 3)}`;
};
function splitAt(text: string, max: number): string[] {
  const output: string[] = [];
  let rest = Array.from(text);
  while (rest.length > max) {
    let cut = max;
    // 拉丁语言优先在单词边界换行；长词和中日韩文字按 Unicode 字符切。
    for (let i = max; i > max * 0.55; i--)
      if (rest[i] === ' ') {
        cut = i;
        break;
      }
    output.push(rest.slice(0, cut).join('').trim());
    rest = rest.slice(cut);
    while (rest[0] === ' ') rest.shift();
  }
  if (rest.length) output.push(rest.join('').trim());
  return output;
}
/** 一条字幕最长显示多久（毫秒），再长就按文字比例拆开。 */
const MAX_CUE_MS = 6000;
/** 被前一条完全盖住、只好接在后面的那一条至少显示多久。 */
const MIN_CUE_MS = 700;

/** 真实识别时间戳生成 SRT；过长原生段落按文字比例拆分，段内时间仅是近似。每条最多两行。 */
export function speechToSrt(
  segments: readonly SpeechSegment[],
  language: SpeechLanguage,
  durationMs: number,
): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '';
  const lineLength = ['zh', 'zh-TW', 'ja', 'ko'].includes(language) ? 21 : 42;
  const fits = (text: string) => splitAt(text, lineLength).length <= 2;
  const end = Math.floor(durationMs);
  const candidates: SpeechSegment[] = [];
  for (const segment of [...segments].sort((a, b) => a.startMs - b.startMs)) {
    if (!Number.isFinite(segment.startMs) || !Number.isFinite(segment.endMs)) continue;
    const startMs = Math.max(0, Math.round(segment.startMs));
    const endMs = Math.min(end, Math.round(segment.endMs));
    if (endMs <= startMs) continue;
    const text = tidyTranscript(
      [{ ...segment, text: segment.text.replace(/\s+/g, ' ') }],
      language,
    ).trim();
    if (!text) continue;
    // 按字数（两行放得下）和时长（不超过 MAX_CUE_MS）两头拆。
    const length = Array.from(text).length;
    const pieces = Math.max(
      Math.ceil(length / (lineLength * 2)),
      Math.ceil((endMs - startMs) / MAX_CUE_MS),
    );
    const chunks = splitAt(text, Math.max(1, Math.ceil(length / pieces))).flatMap((chunk) =>
      fits(chunk) ? [chunk] : splitAt(chunk, lineLength),
    );
    const weights = chunks.map((c) => Array.from(c).length);
    const total = weights.reduce((a, b) => a + b, 0);
    let consumed = 0;
    for (const [i, chunk] of chunks.entries()) {
      const start = startMs + Math.round(((endMs - startMs) * consumed) / total);
      consumed += weights[i]!;
      const stop = startMs + Math.round(((endMs - startMs) * consumed) / total);
      if (stop > start) candidates.push({ startMs: start, endMs: stop, text: chunk });
    }
  }
  const cues: SpeechSegment[] = [];
  for (const candidate of candidates.sort((a, b) => a.startMs - b.startMs)) {
    const previous = cues[cues.length - 1];
    const startMs = Math.max(candidate.startMs, previous?.endMs ?? 0);
    const combined = previous ? tidyTranscript([previous, candidate], language) : candidate.text;
    if (candidate.endMs <= startMs) {
      // 整段都落在前一条的时间里（识别结果互相重叠）：并进前一条；放不下就接在它后面，不能丢字。
      if (!previous) continue;
      if (fits(combined)) previous.text = combined;
      else if (startMs < end)
        cues.push({
          startMs,
          endMs: Math.min(end, startMs + Math.max(MIN_CUE_MS, candidate.endMs - candidate.startMs)),
          text: candidate.text,
        });
      continue;
    }
    if (
      previous &&
      startMs - previous.endMs <= 350 &&
      candidate.endMs - previous.startMs <= MAX_CUE_MS &&
      fits(combined) &&
      !/[.!?。！？]$/.test(previous.text)
    ) {
      previous.text = combined;
      previous.endMs = candidate.endMs;
    } else cues.push({ ...candidate, startMs });
  }
  return cues
    .map(
      (cue, i) =>
        `${i + 1}\r\n${stamp(cue.startMs)} --> ${stamp(cue.endMs)}\r\n${splitAt(cue.text, lineLength).join('\r\n')}\r\n`,
    )
    .join('\r\n');
}
