import { describe, expect, it } from 'vitest';
import { calculateResults, gradeFor, round2, type Band } from './calculate.js';

// A typical Sri Lankan O/L-style scale; the pilot school's own scale replaces this in fixtures (P0-3).
const BANDS: Band[] = [
  { min: 75, grade: 'A', label: 'Distinction' },
  { min: 65, grade: 'B', label: 'Very good' },
  { min: 50, grade: 'C', label: 'Credit' },
  { min: 35, grade: 'S', label: 'Simple pass' },
  { min: 0, grade: 'W', label: 'Weak' },
];

describe('rounding and grades', () => {
  it('rounds half away from zero without float artefacts', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(74.994999)).toBe(74.99);
    expect(round2(-1.005)).toBe(-1.01);
  });
  it('picks the band with the highest minimum at or below the percentage', () => {
    expect(gradeFor(75, BANDS)).toBe('A');
    expect(gradeFor(74.99, BANDS)).toBe('B');
    expect(gradeFor(35, BANDS)).toBe('S');
    expect(gradeFor(0, BANDS)).toBe('W');
  });
});

describe('calculateResults', () => {
  const components = [
    { id: 1, subjectId: 10, name: 'Paper I', maxMarks: 40, weight: 40 },
    { id: 2, subjectId: 10, name: 'Paper II', maxMarks: 60, weight: 60 },
    { id: 3, subjectId: 20, name: 'Paper', maxMarks: 100, weight: 100 },
  ];
  const m = (componentId: number, studentId: number, rawMark: number | null, status: 'present' | 'absent' | 'exempt' = 'present') => ({
    componentId,
    studentId,
    rawMark,
    status,
  });

  it('weights components, grades subjects, totals, averages and ranks with ties', () => {
    const r = calculateResults({
      studentIds: [1, 2, 3, 4],
      subjectIds: [10, 20],
      components,
      bands: BANDS,
      marks: [
        // Student 1: maths 30/40 + 48/60 = 75% + 80% weighted → 78.00; science 70 → avg 74.00
        m(1, 1, 30),
        m(2, 1, 48),
        m(3, 1, 70),
        // Student 2: same average as student 1 (tie)
        m(1, 2, 28),
        m(2, 2, 50),
        m(3, 2, 70),
        // Student 3: absent for science paper → 0, maths exempt on Paper I only
        m(1, 3, null, 'exempt'),
        m(2, 3, 30),
        m(3, 3, null, 'absent'),
        // Student 4: exempt from all maths → only science counts
        m(1, 4, null, 'exempt'),
        m(2, 4, null, 'exempt'),
        m(3, 4, 90),
      ],
    });
    const [s1, s2, s3, s4] = r;
    expect(s1!.subjects[0]).toMatchObject({ percent: 78, grade: 'A', absent: false });
    expect(s1).toMatchObject({ total: 148, average: 74, subjectsCounted: 2 });
    expect(s2!.subjects[0]!.percent).toBe(78);
    expect(s2!.average).toBe(74);
    expect(s3!.subjects[0]).toMatchObject({ percent: 50, grade: 'C' }); // only Paper II counted: 30/60
    expect(s3!.subjects[1]).toMatchObject({ percent: 0, grade: null, absent: true });
    expect(s3!.average).toBe(25);
    expect(s4!.subjects[0]).toMatchObject({ percent: null, exempt: true });
    expect(s4).toMatchObject({ subjectsCounted: 1, average: 90 });
    expect(r.map((x) => x.rank)).toEqual([2, 2, 4, 1]);
  });

  it('leaves a subject uncalculated while a mark is missing', () => {
    const [s] = calculateResults({ studentIds: [1], subjectIds: [10], components, bands: BANDS, marks: [m(1, 1, 20)] });
    expect(s!.subjects[0]).toMatchObject({ percent: null, grade: null });
    expect(s!.subjects[0]!.components[1]!.status).toBe('missing');
    expect(s!.rank).toBeNull();
  });
});
