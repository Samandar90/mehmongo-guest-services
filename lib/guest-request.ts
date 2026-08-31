import type { GuestRequestFields, RoomContextResult, ServiceId } from '../supabase/functions/_shared/contracts';

export type { GuestRequestFields, RoomContextResult, ServiceId } from '../supabase/functions/_shared/contracts';

export type GuestContext = RoomContextResult;
export type RequestFields = GuestRequestFields;

export type RequestErrors = Partial<Record<keyof RequestFields, string>>;

export const emptyRequest: RequestFields = {
  choice: '', pickup: '', destination: '', date: '', time: '', count: '1', guestName: '', contact: '', note: '',
};

const labels: Record<ServiceId, { choice: string; count: string }> = {
  tours: { choice: 'Enter a tour or destination', count: 'Enter at least 1 guest' },
  transport: { choice: '', count: 'Enter at least 1 passenger' },
  restaurants: { choice: 'Enter a restaurant or cuisine', count: 'Enter at least 1 guest' },
  tickets: { choice: 'Enter a ticket type or destination', count: 'Enter at least 1 passenger' },
};

export function validateRequest(service: ServiceId, fields: RequestFields): RequestErrors {
  const errors: RequestErrors = {};
  const required = (key: keyof RequestFields, message: string) => {
    if (!fields[key].trim()) errors[key] = message;
  };

  if (service === 'transport') {
    required('pickup', 'Enter a pickup point');
    required('destination', 'Enter a destination');
  } else {
    required('choice', labels[service].choice);
  }

  required('date', 'Choose a date');
  if (service === 'transport' || service === 'restaurants') required('time', 'Choose a time');
  required('guestName', 'Enter your name');
  required('contact', 'Enter a phone number or messenger contact');

  const count = Number(fields.count);
  if (!Number.isInteger(count) || count < 1) errors.count = labels[service].count;
  return errors;
}

export function createRequestReference(randomValue: number): string {
  const safeValue = Math.min(Math.max(randomValue, 0), 0.999999);
  return `MG-${Math.floor(safeValue * 9000) + 1000}`;
}
