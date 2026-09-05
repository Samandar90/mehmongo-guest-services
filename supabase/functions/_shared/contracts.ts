export type ServiceId = 'tours' | 'transport' | 'restaurants' | 'tickets';

/** Service categories a guest can request. */
export const GUEST_SERVICE_IDS: ServiceId[] = ['tours', 'transport', 'restaurants', 'tickets'];

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
