export type ServiceId = 'tours' | 'transport' | 'restaurants' | 'tickets';

/** Service categories a guest can request. */
export const GUEST_SERVICE_IDS: ServiceId[] = ['tours', 'transport', 'restaurants', 'tickets'];

/**
 * Languages the guest site speaks. Stored with each request so the team
 * answers a guest in the language they were reading, and checked by the
 * database, so the list here and the constraint must move together.
 */
export const GUEST_LOCALES = ['en', 'ru', 'uz', 'zh'] as const;
export type GuestLocale = (typeof GUEST_LOCALES)[number];

export function isGuestLocale(value: unknown): value is GuestLocale {
  return typeof value === 'string' && (GUEST_LOCALES as readonly string[]).includes(value);
}

export const REQUEST_FIELD_MAX_LENGTHS = {
  choice: 200,
  pickup: 200,
  destination: 200,
  guestName: 120,
  contact: 120,
  note: 1000,
} as const;

export type GuestRequestFields = {
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

export type SubmitRequestPayload = {
  roomToken: string;
  idempotencyKey: string;
  service: ServiceId;
  fields: GuestRequestFields;
  website: string;
  /**
   * Catalogue offer the guest chose. Absent for restaurant, custom-quote and
   * older clients; the price is never taken from the client either way.
   */
  offerId?: string | null;
  /** Language the guest was reading the site in. Absent from older clients, which were English. */
  guestLocale?: GuestLocale;
};

export type SubmitRequestResult = {
  reference: string;
  telegramStatus: 'pending' | 'sent' | 'failed';
};

export type RoomContextResult = {
  hotelName: string;
  roomLabel: string;
  roomToken: string;
  services: ServiceId[];
  /** Catalogue enabled for this hotel, or null to keep the previous guest form. */
  catalogId: string | null;
};

export type PublicRoomContext = Omit<RoomContextResult, 'roomToken'>;
