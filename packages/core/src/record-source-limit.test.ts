import { describe, expect, it } from 'vitest';
import { RecordSourceSchema } from './components/records';

// 实测（v34 评测 P10、TD17-en）：模型有时不写 limit，整份回复就被拒绝。不写时用列表平常的 30 条。
describe('RecordSourceSchema limit', () => {
  it('defaults to 30 when the AI leaves it out', () => {
    const parsed = RecordSourceSchema.safeParse({ table: 'books' });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.limit).toBe(30);
  });

  it('still rejects a limit outside 1–100', () => {
    expect(RecordSourceSchema.safeParse({ table: 'books', limit: 0 }).success).toBe(false);
    expect(RecordSourceSchema.safeParse({ table: 'books', limit: 101 }).success).toBe(false);
  });
});
