import { describe, expect, it } from 'vitest';
import { maskAddress, normalizePhone } from './sms.js';

describe('phone numbers and masking', () => {
  it('normalises Sri Lankan numbers to E.164', () => {
    expect(normalizePhone('077 123 4567')).toBe('+94771234567');
    expect(normalizePhone('771234567')).toBe('+94771234567');
    expect(normalizePhone('94771234567')).toBe('+94771234567');
    expect(normalizePhone('+94 (77) 123-4567')).toBe('+94771234567');
    expect(normalizePhone('+447700900123')).toBe('+447700900123');
    expect(normalizePhone('12345')).toBeNull();
  });
  it('masks addresses for the delivery log', () => {
    expect(maskAddress('chandima@example.lk')).toBe('c*******@example.lk');
    expect(maskAddress('+94771234567')).toBe('+9477*****67');
  });
});
