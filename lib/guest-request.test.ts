import { describe, expect, it } from 'vitest';
import {
  createRequestReference,
  readGuestContext,
  validateRequest,
  type RequestFields,
} from './guest-request';

const validTransport: RequestFields = {
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
  it('reads Kamilovs Hotel and room from the QR query', () => {
    expect(readGuestContext(new URLSearchParams('hotel=kamilovs&room=205'))).toEqual({
      hotelId: 'kamilovs',
      hotelName: 'Kamilovs Hotel',
      room: '205',
    });
  });

  it('falls back to the representative room when query data is missing', () => {
    expect(readGuestContext(new URLSearchParams())).toEqual({
      hotelId: 'kamilovs',
      hotelName: 'Kamilovs Hotel',
      room: '205',
    });
  });

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
