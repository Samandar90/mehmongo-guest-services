export type ServiceId = 'tours' | 'transport' | 'restaurants' | 'tickets';

export type GuestContext = {
  hotelId: string;
  hotelName: string;
  room: string;
};

export type RequestFields = {
  choice: string;
  pickup: string;
  destination: string;
  date: string;
  time: string;
  count: string;
  guestName: string;
  contact: string;
  note: string;
};

export type RequestErrors = Partial<Record<keyof RequestFields, string>>;

const hotels: Record<string, string> = {
  kamilovs: 'Kamilovs Hotel',
};

const fallback: GuestContext = {
  hotelId: 'kamilovs',
  hotelName: 'Kamilovs Hotel',
  room: '205',
};

export const emptyRequest: RequestFields = {
  choice: '', pickup: '', destination: '', date: '', time: '', count: '1', guestName: '', contact: '', note: '',
};

export function readGuestContext(searchParams: URLSearchParams): GuestContext {
  const requestedHotel = searchParams.get('hotel')?.trim().toLowerCase() ?? '';
  const requestedRoom = searchParams.get('room')?.trim() ?? '';
  if (!hotels[requestedHotel]) return fallback;

  return {
    hotelId: requestedHotel,
    hotelName: hotels[requestedHotel],
    room: /^[a-z0-9-]{1,12}$/i.test(requestedRoom) ? requestedRoom : fallback.room,
  };
}

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
