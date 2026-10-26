import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ar } from '../ar';
import { en } from '../en';
import { translate } from '..';

// Final round: the pole menu (ColumnContextMenu) and the jumper bar / points (SketchCanvas).

const ARABIC = /[؀-ۿ]/;
const leaves = (o: unknown, p = ''): [string, string][] =>
  Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (v && typeof v === 'object' ? leaves(v, `${p}${k}.`) : [[`${p}${k}`, v as string]]));
const strip = (c: string) => c.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const code = (f: string) => strip(readFileSync(resolve(__dirname, '../../components', f), 'utf8'));

describe('pole menu and jumper tool', () => {
  it('columnMenu and jumper: same keys in both languages, filled; English has no Arabic; approved terms', () => {
    for (const sec of ['columnMenu', 'jumper'] as const) {
      expect(leaves(en[sec]).map(([k]) => k)).toEqual(leaves(ar[sec]).map(([k]) => k));
      for (const [k, v] of [...leaves(ar[sec]), ...leaves(en[sec])]) expect(v.trim().length, `${sec}.${k}`).toBeGreaterThan(0);
      for (const [k, v] of leaves(en[sec])) expect(v, `${sec}.${k}`).not.toMatch(ARABIC);
      for (const [k, v] of leaves(ar[sec])) expect(v, `${sec}.${k}`).not.toMatch(/كيبل|كيابل|فولتية/);
    }
  });

  it('the menu item for the source has the name the voltage-drop panel tells the user to look for', () => {
    expect(ar.vd.howToSource).toContain(`«${ar.columnMenu.vdSource}»`);
    expect(en.vd.howToSource).toContain(`«${en.columnMenu.vdSource}»`);
  });

  it('placeholders are filled in both languages', () => {
    expect(translate('ar', 'columnMenu.cableFromTo', { from: 'محول 1', to: 'عمود 2' })).toBe('كابل من محول 1 إلى عمود 2');
    expect(translate('en', 'columnMenu.cableFromTo', { from: 'Transformer 1', to: 'Pole 2' })).toBe('Cable from Transformer 1 to Pole 2');
    expect(translate('ar', 'jumper.chooseSecond', { n: 3 })).toBe('النقطة الثانية (الأولى: 3)');
    expect(translate('en', 'jumper.pickPoint', { n: 2 })).toBe('Choose point 2');
    expect(translate('en', 'jumper.point', { n: 4 })).toBe('Connection point 4');
  });

  it('no visible Arabic or English text is left written in the pole menu code', () => {
    const c = code('ColumnContextMenu.tsx');
    expect(c).not.toMatch(ARABIC);
    expect(c).not.toMatch(/<span>[A-Za-z]/);
    expect(c).not.toMatch(/aria-label="/);
  });

  it('the jumper bar and points take their texts from the dictionary, the bar follows the language direction', () => {
    const c = code('SketchCanvas.tsx');
    const bar = c.slice(c.indexOf('{arcPickState && ('), c.indexOf('{editingDistance && ('));
    expect(bar).not.toMatch(ARABIC);
    expect(bar).toContain('dir={uiDir}');
    expect(c).toContain("aria-label={tr('jumper.point', { n: p.number })}");
  });

  it('the default note text stays «Note» (it is saved in the project, not an interface text)', () => {
    expect(code('ColumnContextMenu.tsx')).toContain("text: 'Note'");
  });
});
