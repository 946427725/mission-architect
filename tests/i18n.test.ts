import { beforeAll, describe, expect, it } from 'vitest';
import { keyOf, prepareForTests, tr } from '../src/i18n/i18n';
import { settings } from '../src/ui/settings';
import uz from '../src/i18n/uz.json';

beforeAll(async () => {
  settings.lang = 'uz';
  await prepareForTests();
});

describe('Uzbek translation', () => {
  it('translates plain UI text and keeps English when switched off', () => {
    expect(tr('Mission tasks')).toBe('Missiya vazifalari');
    settings.lang = 'en';
    expect(tr('Mission tasks')).toBe('Mission tasks');
    settings.lang = 'uz';
  });

  it('puts the numbers back in, in the right order', () => {
    expect(tr('need 120 W')).toBe('120 Vt kerak');
    expect(tr('You returned 87 of 100 science points.')).toContain('87');
    expect(tr('You returned 87 of 100 science points.')).toContain('100');
  });

  it('never splits a number between two inserted pieces', () => {
    const t = tr('210 science pts');
    expect(t).not.toMatch(/[{}]/);
    expect(t).toContain('210');
  });

  it('translates lower-cased names inserted into a sentence', () => {
    const t = tr('Global dust storm, and your nuclear power (rtg) saved the mission. You returned 208 science points.');
    expect(t).not.toMatch(/nuclear power/i);
  });

  it('every dictionary entry fills cleanly (no leftover placeholders)', () => {
    let n = 0;
    for (const [k, v] of Object.entries(uz as Record<string, string>)) {
      if (!v || !/[A-Za-z]{2}/.test(k)) continue;
      // build an English sample: numbers for {}, a plain word for {*}
      let i = 0;
      const sample = k.replace(/\{\*?\}/g, (m) => (m === '{}' ? String(10 + i++) : 'Mars')).replace(/<([a-z])\/>/g, '').replace(/<\/?[a-z]>/g, '');
      if (keyOf(sample).key !== k.replace(/\{\*\}/g, 'Mars').replace(/<\/?[a-z]\/?>/g, '')) continue;
      const t = tr(sample);
      expect(t, k).not.toMatch(/\{\d*\*?\}|/);
      n++;
    }
    expect(n).toBeGreaterThan(500);
  });

  it('uses the Uzbek letters o‘ and g‘, never a plain apostrophe', () => {
    const bad = Object.values(uz as Record<string, string>).filter((v) => /[oOgG]'/.test(v));
    expect(bad).toEqual([]);
  });
});
