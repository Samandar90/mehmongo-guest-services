import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  tashkentDate,
  validateRequest,
} from './guest-request';
import type { GuestRequestFields } from '../supabase/functions/_shared/contracts';

const validTransport: GuestRequestFields = {
  pickup: 'Kamilovs Hotel',
  destination: 'Samarkand railway station',
  date: '2026-09-05',
  time: '18:30',
  count: '2',
  guestName: 'Amir Khan',
  contact: '@amir',
  note: '',
  choice: '',
};

afterEach(() => vi.useRealTimers());

describe('guest request domain', () => {
  it('accepts a complete transport request', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T12:00:00.000Z'));
    expect(validateRequest('transport', validTransport)).toEqual({});
  });

  it('explains a missing destination', () => {
    expect(validateRequest('transport', { ...validTransport, destination: '' }).destination).toBe('Enter a destination');
  });

  it('requires a positive guest count', () => {
    expect(validateRequest('transport', { ...validTransport, count: '0' }).count).toBe('Enter at least 1 passenger');
  });

  it('rejects past dates and counts outside the API range', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T12:00:00.000Z'));
    expect(validateRequest('transport', { ...validTransport, date: '2026-09-04' }).date).toBe('Choose today or a future date');
    expect(validateRequest('transport', { ...validTransport, count: '51' }).count).toBe('Enter 1 to 50 passengers');
  });

  it('rejects an invalid calendar date before submission', () => {
    expect(validateRequest('transport', { ...validTransport, date: '2026-02-30' }).date).toBe('Choose a valid date');
  });
});

describe('tashkentDate', () => {
  it('is already tomorrow in Tashkent while UTC is still on yesterday', () => {
    // 02:00 in Tashkent on 23 September is 21:00 UTC on the 22nd.
    const night = new Date('2026-09-22T21:00:00Z');
    expect(tashkentDate(0, night)).toBe('2026-09-23');
    expect(tashkentDate(1, night)).toBe('2026-09-24');
  });

  it('crosses a month end', () => {
    expect(tashkentDate(1, new Date('2026-09-30T12:00:00Z'))).toBe('2026-10-01');
  });
});
