import { describe, expect, it } from 'vitest';
import {
  createRequestReference,
  validateRequest,
} from './guest-request';
import type { GuestRequestFields } from '../supabase/functions/_shared/contracts';

const validTransport: GuestRequestFields = {
  pickup: 'Kamilovs Hotel',
  destination: 'Samarkand railway station',
  date: '2026-09-02',
  time: '18:30',
  count: '2',
  guestName: 'Amir Khan',
  contact: '@amir',
  note: '',
  choice: '',
};

describe('guest request domain', () => {
  it('accepts a complete transport request', () => {
    expect(validateRequest('transport', validTransport)).toEqual({});
  });

  it('explains a missing destination', () => {
    expect(validateRequest('transport', { ...validTransport, destination: '' }).destination).toBe('Enter a destination');
  });

  it('requires a positive guest count', () => {
    expect(validateRequest('transport', { ...validTransport, count: '0' }).count).toBe('Enter at least 1 passenger');
  });

  it('creates four-digit MehmonGo references', () => {
    expect(createRequestReference(0)).toBe('MG-1000');
    expect(createRequestReference(0.9999)).toBe('MG-9999');
  });
});
