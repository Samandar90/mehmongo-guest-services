import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The guest interface is styled by hand in globals.css: the shadcn utility
 * classes the components also carry (bg-primary, text-primary-foreground) are
 * never generated into the bundle, so a rule that paints a dark background
 * without stating a colour leaves the label inheriting body's navy text on a
 * navy button. That shipped invisible labels on every submit button once.
 */
const stylesheet = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8');

type Rule = { selector: string; declarations: string };

function rules(css: string): Rule[] {
  const parsed: Rule[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    parsed.push({ selector: match[1].trim().replaceAll(/\s+/g, ' '), declarations: match[2] });
  }
  return parsed;
}

function declares(declarations: string, property: string): boolean {
  return new RegExp(`(^|;)\\s*${property}\\s*:`).test(declarations);
}

describe('globals.css', () => {
  it('states a text colour wherever it paints a dark brand background', () => {
    const dark = rules(stylesheet).filter((rule) =>
      /background(-color)?:[^;]*(var\(--navy\)|#102b4e)/.test(rule.declarations),
    );

    expect(dark.length).toBeGreaterThan(0);
    expect(dark.filter((rule) => !declares(rule.declarations, 'color')).map((rule) => rule.selector)).toEqual([]);
  });
});
