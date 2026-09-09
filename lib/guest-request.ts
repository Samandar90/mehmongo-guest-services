import type { GuestRequestFields, RoomContextResult, ServiceId } from '../supabase/functions/_shared/contracts';
import { en, type Messages } from './i18n/messages/en';

export type { GuestRequestFields, RoomContextResult, ServiceId } from '../supabase/functions/_shared/contracts';

export type GuestContext = RoomContextResult;
export type RequestFields = GuestRequestFields;

export type RequestErrors = Partial<Record<keyof RequestFields, string>>;

/** The wording of each validation message, in the guest's language. */
export type ValidationMessages = Messages['validation'];

export const emptyRequest: RequestFields = {
  choice: '', pickup: '', destination: '', date: '', time: '', count: '1', guestName: '', contact: '', note: '',
};

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateRequest(
  service: ServiceId,
  fields: RequestFields,
  messages: ValidationMessages = en.validation,
): RequestErrors {
  const errors: RequestErrors = {};
  const required = (key: keyof RequestFields, message: string) => {
    if (!fields[key].trim()) errors[key] = message;
  };

  if (service === 'transport') {
    required('pickup', messages.pickup);
    required('destination', messages.destination);
  } else {
    required('choice', messages.choice[service]);
  }

  required('date', messages.date);
  if (fields.date && !isValidDate(fields.date)) {
    errors.date = messages.validDate;
  } else if (fields.date && fields.date < new Date().toISOString().slice(0, 10)) {
    errors.date = messages.futureDate;
  }
  if (service === 'transport' || service === 'restaurants') required('time', messages.time);
  required('guestName', messages.name);
  required('contact', messages.contact);

  const count = Number(fields.count);
  const guests = service === 'tours' || service === 'restaurants';
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    errors.count = count > 50
      ? (guests ? messages.guestRange : messages.passengerRange)
      : (guests ? messages.atLeastOneGuest : messages.atLeastOnePassenger);
  }
  return errors;
}
