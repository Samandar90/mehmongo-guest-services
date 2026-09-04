export type ServiceId = 'tours' | 'transport' | 'restaurants' | 'tickets';

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
};

export type PublicRoomContext = Omit<RoomContextResult, 'roomToken'>;
