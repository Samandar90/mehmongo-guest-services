import { describe, expect, it } from 'vitest';
import { locales } from '../locale';
import { messages } from './index';
import { airportDirections, mountainPreferences, ticketModes } from '@/supabase/functions/_shared/catalog';

type Leaf = { path: string; value: unknown };

function leaves(value: unknown, path = ''): Leaf[] {
  if (Array.isArray(value)) return value.flatMap((entry, index) => leaves(entry, `${path}[${index}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, nested]) => leaves(nested, path ? `${path}.${key}` : key));
  }
  return [{ path, value }];
}

describe('guest messages', () => {
  it('translates every string in every language', () => {
    const reference = leaves(messages.en);
    for (const locale of locales) {
      const translated = new Map(leaves(messages[locale]).map((leaf) => [leaf.path, leaf.value]));
      for (const leaf of reference) {
        expect(translated.has(leaf.path), `${locale} is missing ${leaf.path}`).toBe(true);
        const value = translated.get(leaf.path);
        expect(typeof value, `${locale} ${leaf.path}`).toBe(typeof leaf.value);
        if (typeof value === 'string') expect(value.trim(), `${locale} ${leaf.path} is blank`).not.toBe('');
      }
    }
  });

  it('labels every fixed choice the server accepts', () => {
    const canonical = [...mountainPreferences, ...airportDirections, ...ticketModes];
    for (const locale of locales) {
      for (const value of canonical) {
        expect(messages[locale].choices[value], `${locale} lacks a label for ${value}`).toBeTruthy();
      }
    }
  });

  it('keeps the stored choice values English on the way to the team', () => {
    // A guest choosing the Russian label still submits the canonical value.
    expect(messages.ru.choices['Airport → hotel']).toBe('Аэропорт → отель');
    expect(Object.keys(messages.ru.choices)).toEqual(Object.keys(messages.en.choices));
  });

  it('formats the room, the price and the seat limit in each language', () => {
    expect(messages.en.common.room('205')).toBe('Room 205');
    expect(messages.ru.common.room('205')).toBe('Комната 205');
    expect(messages.uz.common.room('205')).toBe('205-xona');
    expect(messages.zh.common.room('205')).toBe('205 号房');

    expect(messages.en.catalog.fromPrice('$120')).toBe('From $120');
    expect(messages.ru.catalog.fromPrice('$120')).toBe('от $120');
    expect(messages.uz.catalog.fromPrice('$120')).toBe('$120 dan');
    expect(messages.zh.catalog.fromPrice('$120')).toBe('$120 起');

    for (const locale of locales) {
      expect(messages[locale].offerForm.seatsUpTo(3)).toContain('3');
      expect(messages[locale].welcome.count(4)).toContain('4');
    }
  });

  it('declines Russian service counts', () => {
    expect(messages.ru.welcome.count(1)).toBe('1 услуга');
    expect(messages.ru.welcome.count(3)).toBe('3 услуги');
    expect(messages.ru.welcome.count(5)).toBe('5 услуг');
    expect(messages.ru.welcome.count(21)).toBe('21 услуга');
    expect(messages.ru.welcome.count(12)).toBe('12 услуг');
  });

  it('writes Uzbek with the typographic apostrophes, not ASCII quotes', () => {
    const text = JSON.stringify(leaves(messages.uz).map((leaf) => leaf.value));
    expect(text).not.toMatch(/[a-z]'[a-z]/i);
    expect(text).toContain('ʻ');
  });
});
