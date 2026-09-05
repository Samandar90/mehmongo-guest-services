import { afterEach, describe, expect, it, vi } from 'vitest';
import {
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
