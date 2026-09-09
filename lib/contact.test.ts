import { describe, expect, it } from 'vitest';
import { guestContact, telegramLink, whatsappLink } from './contact';

describe('guest contact', () => {
  it('builds a WhatsApp link with the request text', () => {
    const link = whatsappLink('Hello! My request is MG-ABCDEFGH (Old City Hotel, Room 302).');
    expect(link).toBe(`https://wa.me/${guestContact.whatsapp}?text=Hello!%20My%20request%20is%20MG-ABCDEFGH%20(Old%20City%20Hotel%2C%20Room%20302).`);
  });

  it('keeps the WhatsApp number in the digits-only form wa.me expects', () => {
    expect(guestContact.whatsapp).toMatch(/^\d{9,15}$/);
  });

  it('offers Telegram only once a username is configured', () => {
    const link = telegramLink('Здравствуйте! Моя заявка MG-ABCDEFGH.');
    if (guestContact.telegram) {
      expect(link).toBe(`https://t.me/${guestContact.telegram}?text=${encodeURIComponent('Здравствуйте! Моя заявка MG-ABCDEFGH.')}`);
      expect(guestContact.telegram).not.toMatch(/^@/);
    } else {
      expect(link).toBeNull();
    }
  });

  it('promises hours a person can keep', () => {
    expect(guestContact.replyMinutes).toBeGreaterThan(0);
    expect(guestContact.hoursFrom).toMatch(/^\d{2}:\d{2}$/);
    expect(guestContact.hoursTo).toMatch(/^\d{2}:\d{2}$/);
    expect(guestContact.hoursFrom < guestContact.hoursTo).toBe(true);
  });
});
