import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isEmailIdentifier } from './constants.js';

describe('constants module', () => {
  it('stays free of zod so the web bundle does not pull in the validator', () => {
    const src = readFileSync(new URL('./constants.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from ['"]zod['"]/);
    expect(src).not.toMatch(/from ['"]\.\/schemas/);
  });

  it('recognises email identifiers', () => {
    expect(isEmailIdentifier('teacher@school.lk')).toBe(true);
    expect(isEmailIdentifier('student.001')).toBe(false);
    expect(isEmailIdentifier('a@b')).toBe(false);
  });
});
