import { describe, expect, it } from 'vitest';
import { hotelPickupLine, validateRequest } from './guest-request';
import type { GuestRequestFields } from '../supabase/functions/_shared/contracts';

const asapTransport: GuestRequestFields = {
  pickup: 'Kamilovs Hotel, Xromiy 7',
  destination: 'Airport',
  date: '',
  time: '',
  count: '2',
  guestName: 'Amir Khan',
  contact: '@amir',
  note: '',
  choice: '',
};

describe('as soon as possible', () => {
  it('needs neither a date nor a time for a transfer', () => {
    expect(validateRequest('transport', asapTransport, undefined, true)).toEqual({});
  });

  it('still needs the pickup, the destination and a way to reach the guest', () => {
    const errors = validateRequest('transport', { ...asapTransport, destination: '', contact: '' }, undefined, true);
    expect(errors.destination).toBe('Enter a destination');
    expect(errors.contact).toBe('Enter a phone number or messenger contact');
    expect(errors.date).toBeUndefined();
    expect(errors.time).toBeUndefined();
  });

  it('asks for the date and time as before when it is off', () => {
    const errors = validateRequest('transport', asapTransport);
    expect(errors.date).toBe('Choose a date');
    expect(errors.time).toBe('Choose a time');
  });
});

describe('hotelPickupLine', () => {
  it('joins the hotel name and address, or uses the name alone', () => {
    expect(hotelPickupLine({ hotelName: 'Kamilovs Hotel', hotelAddress: 'Xromiy 7' })).toBe('Kamilovs Hotel, Xromiy 7');
    expect(hotelPickupLine({ hotelName: 'Kamilovs Hotel', hotelAddress: '' })).toBe('Kamilovs Hotel');
  });
});
