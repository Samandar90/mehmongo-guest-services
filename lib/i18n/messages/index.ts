import type { Locale } from '../locale';
import { en, type Messages } from './en';
import { ru } from './ru';
import { uz } from './uz';
import { zh } from './zh';

export type { Messages } from './en';

export const messages: Record<Locale, Messages> = { en, ru, uz, zh };
