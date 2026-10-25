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
/** 真实识别时间戳生成 SRT；过长原生段落按文字比例拆分，段内时间仅是近似。 */
export function speechToSrt(
  segments: readonly SpeechSegment[],
  language: SpeechLanguage,
  durationMs: number,
): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '';
  const lineLength = ['zh', 'zh-TW', 'ja', 'ko'].includes(language) ? 21 : 42;
  const candidates: SpeechSegment[] = [];
  for (const segment of [...segments].sort((a, b) => a.startMs - b.startMs)) {
    if (!Number.isFinite(segment.startMs) || !Number.isFinite(segment.endMs)) continue;
    const startMs = Math.max(0, Math.round(segment.startMs));
    const endMs = Math.min(Math.floor(durationMs), Math.round(segment.endMs));
    if (endMs <= startMs) continue;
    const text = tidyTranscript(
      [{ ...segment, text: segment.text.replace(/\s+/g, ' ') }],
      language,
    ).trim();
    if (!text) continue;
    const chunks = splitAt(
      text,
      Math.max(lineLength * 2, Math.ceil(Array.from(text).length / (endMs - startMs))),
    );
    const weights = chunks.map((c) => Array.from(c).length);
    const total = weights.reduce((a, b) => a + b, 0);
    let consumed = 0;
    for (const [i, chunk] of chunks.entries()) {
      const start = startMs + Math.round(((endMs - startMs) * consumed) / total);
      consumed += weights[i]!;
      const end = startMs + Math.round(((endMs - startMs) * consumed) / total);
      if (end > start) candidates.push({ startMs: start, endMs: end, text: chunk });
    }
  }
  const cues: SpeechSegment[] = [];
  for (const candidate of candidates.sort((a, b) => a.startMs - b.startMs)) {
    const previous = cues[cues.length - 1];
    const startMs = Math.max(candidate.startMs, previous?.endMs ?? 0);
    if (candidate.endMs <= startMs) continue;
    const combined = previous ? tidyTranscript([previous, candidate], language) : candidate.text;
    if (
      previous &&
      startMs - previous.endMs <= 350 &&
      candidate.endMs - previous.startMs <= 6000 &&
      Array.from(combined).length <= lineLength * 2 &&
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
