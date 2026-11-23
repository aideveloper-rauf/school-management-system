import { describe, expect, it } from 'vitest';
import { hashPassword, needsRehash, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('verifies the correct password and rejects others', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('wrong password!!', h)).toBe(false);
    expect(needsRehash(h)).toBe(false);
  });

  it('produces a different salt each time', async () => {
    expect(await hashPassword('same-password-1')).not.toBe(await hashPassword('same-password-1'));
  });

  it('rejects malformed hashes', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
  });
});
