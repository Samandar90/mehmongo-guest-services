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

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

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
  if (fields.date && !isValidDate(fields.date)) {
    errors.date = 'Choose a valid date';
  } else if (fields.date && fields.date < new Date().toISOString().slice(0, 10)) {
    errors.date = 'Choose today or a future date';
  }
  if (service === 'transport' || service === 'restaurants') required('time', 'Choose a time');
  required('guestName', 'Enter your name');
  required('contact', 'Enter a phone number or messenger contact');

  const count = Number(fields.count);
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    errors.count = count > 50 ? `Enter 1 to 50 ${service === 'tours' || service === 'restaurants' ? 'guests' : 'passengers'}` : labels[service].count;
  }
  return errors;
}
