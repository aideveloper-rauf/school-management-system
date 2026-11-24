import { useMemo } from 'react';
import { query, useResource } from './data';
import type { Section, Year } from '../pages/students/types';

/** Academic years; `current` is the year marked current (or the newest). */
export function useYears() {
  const res = useResource<{ items: Year[] }>('/academic-years');
  const years = useMemo(() => res.data?.items ?? [], [res.data]);
  const current = years.find((y) => y.isCurrent) ?? years[0];
  return { years, current, loading: res.loading, reload: res.reload };
}

/** Class sections of a year (null = don't load yet). */
export function useSections(academicYearId: string | number | null) {
  const res = useResource<{ items: Section[] }>(academicYearId ? `/class-sections${query({ academicYearId })}` : null);
  return { sections: res.data?.items ?? [], loading: res.loading };
}

export const sectionLabel = (s: { name: string; grade: { name: string } }) => `${s.grade.name} / ${s.name}`;
