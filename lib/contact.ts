import contact from '@/content/contact.json';

/**
 * How a guest reaches the team directly, from content/contact.json.
 *
 * `whatsapp` is the number in international format without "+" or spaces, as
 * wa.me wants it; `telegram` is the username without "@", and the Telegram
 * button stays hidden until it is set. The hours and the reply time are the
 * promise printed on the confirmation screen — change the file, not the copy.
 */
export const guestContact: {
  phone: string;
  whatsapp: string;
  telegram: string;
  replyMinutes: number;
  hoursFrom: string;
  hoursTo: string;
} = contact;

export function whatsappLink(text: string): string | null {
  if (!guestContact.whatsapp) return null;
  return `https://wa.me/${guestContact.whatsapp}?text=${encodeURIComponent(text)}`;
}

export function telegramLink(text: string): string | null {
  if (!guestContact.telegram) return null;
  return `https://t.me/${guestContact.telegram}?text=${encodeURIComponent(text)}`;
}
