/**
 * Result calculation (roadmap E-5). Pure functions: no database, so the rules can be tested against the
 * pilot school's own sheets (fixtures from P0-3) and changed in one place.
 *
 * Default rules (until P0-3 confirms the school's):
 * - Subject percentage = Σ(mark ÷ max × weight) ÷ Σ(weight of components not exempt) × 100.
 *   Absent counts as 0; exempt components are left out. All components exempt → subject exempt (not counted).
 *   All counted components absent → subject marked absent (shown as "AB", counted as 0).
 * - Subject grade = the band with the highest minimum ≤ percentage.
 * - Total = sum of counted subject percentages; average = total ÷ number of counted subjects.
 * - Rank by average within the class, standard competition ranking (1, 2, 2, 4). No rank without a counted subject.
 * - Rounding: percentages and averages to 2 decimal places, half away from zero, computed in hundredths.
 */
export interface Band {
  min: number;
  grade: string;
  label: string | null;
}
export interface ComponentInput {
  id: number;
  subjectId: number;
  name: string;
  maxMarks: number;
  weight: number;
}
export interface MarkInput {
  componentId: number;
  studentId: number;
  status: 'present' | 'absent' | 'exempt';
  rawMark: number | null;
}
export interface SubjectResult {
  subjectId: number;
  percent: number | null;
  grade: string | null;
  absent: boolean;
  exempt: boolean;
  components: Array<{
    componentId: number;
    name: string;
    status: MarkInput['status'] | 'missing';
    rawMark: number | null;
    maxMarks: number;
  }>;
}
export interface StudentResult {
  studentId: number;
  subjects: SubjectResult[];
  subjectsCounted: number;
  total: number;
  average: number | null;
  rank: number | null;
}

/** Round to 2 decimals, half away from zero, avoiding binary float artefacts (1.005 → 1.01). */
export function round2(x: number): number {
  const sign = Math.sign(x);
  return (sign * Math.round(Number((Math.abs(x) * 100).toPrecision(15)))) / 100;
}

export function gradeFor(percent: number, bands: Band[]): string {
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  return (sorted.find((b) => percent >= b.min) ?? sorted[sorted.length - 1]!).grade;
}

export function calculateResults(input: {
  studentIds: number[];
  subjectIds: number[];
  components: ComponentInput[];
  marks: MarkInput[];
  bands: Band[];
}): StudentResult[] {
  const markOf = new Map(input.marks.map((m) => [`${m.componentId}:${m.studentId}`, m]));
  const results: StudentResult[] = input.studentIds.map((studentId) => {
    const subjects: SubjectResult[] = input.subjectIds.map((subjectId) => {
      const comps = input.components.filter((c) => c.subjectId === subjectId);
      const parts = comps.map((c) => {
        const m = markOf.get(`${c.id}:${studentId}`);
        return { c, status: (m?.status ?? 'missing') as SubjectResult['components'][number]['status'], raw: m?.rawMark ?? null };
      });
      const counted = parts.filter((p) => p.status !== 'exempt' && p.status !== 'missing');
      const exempt = parts.length > 0 && parts.every((p) => p.status === 'exempt');
      const missing = parts.some((p) => p.status === 'missing');
      let percent: number | null = null;
      let grade: string | null = null;
      const absent = counted.length > 0 && counted.every((p) => p.status === 'absent');
      if (!exempt && !missing && counted.length > 0) {
        const weights = counted.reduce((s, p) => s + p.c.weight, 0);
        const score = counted.reduce((s, p) => s + (p.status === 'present' ? (p.raw! / p.c.maxMarks) * p.c.weight : 0), 0);
        percent = round2((score / weights) * 100);
        grade = absent ? null : gradeFor(percent, input.bands);
      }
      return {
        subjectId,
        percent,
        grade,
        absent,
        exempt,
        components: parts.map((p) => ({ componentId: p.c.id, name: p.c.name, status: p.status, rawMark: p.raw, maxMarks: p.c.maxMarks })),
      };
    });
    const countedSubjects = subjects.filter((s) => s.percent !== null);
    const total = round2(countedSubjects.reduce((s, x) => s + x.percent!, 0));
    return {
      studentId,
      subjects,
      subjectsCounted: countedSubjects.length,
      total,
      average: countedSubjects.length ? round2(total / countedSubjects.length) : null,
      rank: null,
    };
  });
  const ranked = results.filter((r) => r.average !== null).sort((a, b) => b.average! - a.average!);
  ranked.forEach((r, i) => {
    r.rank = i > 0 && ranked[i - 1]!.average === r.average ? ranked[i - 1]!.rank : i + 1;
  });
  return results;
}
