import type { AppConfig } from '../config/env.js';

/**
 * Optional AI drafting (roadmap Phase 5). OFF by default.
 *
 * Rules (instruction.md → Privacy and security):
 * - Available only when FEATURE_AI=true, a provider is configured, AND the school has opted in.
 * - Inputs are curriculum fields only: subject, grade, learning outcome, difficulty, count. No student names,
 *   marks, attendance, work or messages ever reach a provider. `assertCurriculumOnly` refuses outcome text that
 *   looks like personal data (email, phone, long ID numbers) or contains a student's name.
 * - Output is a DRAFT for a teacher to edit; it is saved only as a draft question that still goes through review.
 *
 * Providers implement `AiProvider`. No provider is bundled yet: adding one (e.g. Claude via the official
 * `@anthropic-ai/sdk`) is a deliberate dependency decision — see docs/architecture.md → AI.
 */
export interface CurriculumPrompt {
  subject: string;
  grade: string | null;
  outcome: string;
  difficulty: 'easy' | 'medium' | 'hard';
  language: 'en' | 'si' | 'ta';
  count: number;
}
export interface QuestionDraft {
  kind: 'mcq' | 'short' | 'essay';
  stem: string;
  options: Array<{ text: string; correct: boolean }> | null;
  answer: string | null;
  marks: number;
}
export interface AiProvider {
  readonly name: string;
  draftQuestions(input: CurriculumPrompt): Promise<QuestionDraft[]>;
}

export class PersonalDataError extends Error {}

/** Refuse text that looks like it carries personal data. `names` = student names to check against. */
export function assertCurriculumOnly(text: string, names: string[] = []): void {
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(text)) throw new PersonalDataError('email');
  if (/(\+?\d[\d\s()-]{7,}\d)/.test(text)) throw new PersonalDataError('phone or id number');
  if (/\d{5,}/.test(text)) throw new PersonalDataError('id number');
  const lower = text.toLowerCase();
  for (const n of names) {
    const parts = n
      .toLowerCase()
      .split(/\s+/)
      .filter((p) => p.length >= 4);
    if (parts.length >= 2 && parts.every((p) => lower.includes(p))) throw new PersonalDataError('student name');
  }
}

/** Validate a provider's drafts before they reach a teacher (never trust model output shape). */
export function cleanDrafts(drafts: unknown, max: number): QuestionDraft[] {
  if (!Array.isArray(drafts)) return [];
  const out: QuestionDraft[] = [];
  for (const d of drafts.slice(0, max)) {
    const x = d as Partial<QuestionDraft>;
    if (!x || typeof x.stem !== 'string' || !x.stem.trim() || !['mcq', 'short', 'essay'].includes(String(x.kind))) continue;
    const options =
      x.kind === 'mcq' && Array.isArray(x.options)
        ? x.options
            .filter((o) => o && typeof o.text === 'string')
            .slice(0, 8)
            .map((o) => ({ text: o.text.slice(0, 1000), correct: Boolean(o.correct) }))
        : null;
    if (x.kind === 'mcq' && (!options || options.length < 2 || options.filter((o) => o.correct).length !== 1)) continue;
    const marks = typeof x.marks === 'number' && x.marks > 0 && x.marks <= 100 ? Math.round(x.marks * 2) / 2 : 1;
    out.push({
      kind: x.kind!,
      stem: x.stem.trim().slice(0, 10_000),
      options,
      answer: typeof x.answer === 'string' ? x.answer.slice(0, 10_000) : null,
      marks,
    });
  }
  return out;
}

/** The configured provider, or null (AI off). No provider ships with this release. */
export function createAiProvider(cfg: Pick<AppConfig, 'FEATURE_AI'>): AiProvider | null {
  if (!cfg.FEATURE_AI) return null;
  return null;
}
