import { describe, expect, it } from 'vitest';
import { ROLES, ROLE_PERMISSIONS, hasPermission, permissionsFor } from './roles.js';

describe('role permissions', () => {
  it('defines a permission list for every role', () => {
    for (const r of ROLES) expect(ROLE_PERMISSIONS[r]).toBeDefined();
  });

  it('ignores unknown roles', () => {
    expect(permissionsFor(['superuser']).size).toBe(0);
  });

  it('does not let students or guardians read other students', () => {
    for (const r of ['student', 'guardian']) {
      expect(hasPermission([r], 'students.read.all')).toBe(false);
      expect(hasPermission([r], 'students.read.scoped')).toBe(false);
    }
  });

  it('keeps result publication away from teachers and admins by default', () => {
    expect(hasPermission(['teacher'], 'results.publish')).toBe(false);
    expect(hasPermission(['school_admin'], 'results.publish')).toBe(false);
    expect(hasPermission(['principal'], 'results.publish')).toBe(true);
  });

  it('merges permissions across multiple roles', () => {
    const p = permissionsFor(['teacher', 'registrar']);
    expect(p.has('marks.enter.scoped')).toBe(true);
    expect(p.has('students.manage')).toBe(true);
  });
});
