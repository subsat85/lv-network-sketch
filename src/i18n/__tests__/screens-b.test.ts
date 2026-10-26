import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ar } from '../ar';
import { en } from '../en';
import { translate, type TKey, type TParams } from '..';
import { useLocale } from '../../store/localeStore';
import { groupCables, cableLabelParts } from '../../utils/cableGroups';
import { proposalLoadText } from '../../utils/proposedConsumers';
import { poleNamer } from '../../utils/poleNames';
import type { CableElement, DrawingElement } from '../../types/drawing';

// Phase 5 / batch B: the load report, the cable colour bar and the proposed subscriber sheet.

const EN = (k: TKey, p?: TParams) => translate('en', k, p);
const ARABIC = /[؀-ۿ]/;
const leaves = (o: unknown, p = ''): [string, string][] =>
  Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (v && typeof v === 'object' ? leaves(v, `${p}${k}.`) : [[`${p}${k}`, v as string]]));
const strip = (c: string) => c.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const code = (f: string) => strip(readFileSync(resolve(__dirname, '../../components', f), 'utf8'));
const pole = (id: string, symbolId = 'lv-pole') => ({ id, type: 'symbol', symbolId, x: 0, y: 0, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2 }) as DrawingElement;
const cable = (id: string, poleIds: string[], strokeColor: string) => ({ id, type: 'cable', x: 0, y: 0, poleIds, cableIndex: 0, offset: 0, strokeColor, fillColor: 'none', strokeWidth: 2 }) as CableElement;

afterEach(() => useLocale.getState().setLocale('ar'));

describe('remaining screens, batch B', () => {
  it('loads, colourBar and proposal: same keys in both languages, filled; English has no Arabic; approved terms', () => {
    for (const sec of ['loads', 'colourBar', 'proposal'] as const) {
      expect(leaves(en[sec]).map(([k]) => k)).toEqual(leaves(ar[sec]).map(([k]) => k));
      for (const [k, v] of [...leaves(ar[sec]), ...leaves(en[sec])]) expect(v.trim().length, `${sec}.${k}`).toBeGreaterThan(0);
      for (const [k, v] of leaves(en[sec])) expect(v, `${sec}.${k}`).not.toMatch(ARABIC);
      for (const [k, v] of leaves(ar[sec])) expect(v, `${sec}.${k}`).not.toMatch(/كيبل|كيابل|فولتية|\bفاز\b|الفاز|امبير/);
    }
  });

  it('pole names use the approved term «محول»', () => {
    const name = poleNamer([pole('T', 'transformer'), pole('A')]);
    expect([name('T'), name('A'), name('x')]).toEqual(['محول 1', 'عمود 1', 'عمود محذوف']);
    const enName = poleNamer([pole('T', 'transformer'), pole('A')], EN);
    expect([enName('T'), enName('A'), enName('x')]).toEqual(['Transformer 1', 'Pole 1', 'Deleted pole']);
  });

  it('the colour bar groups are named in the language; the grouping itself is the same', () => {
    const els = [pole('T1', 'transformer'), pole('A'), pole('B'), cable('a', ['T1', 'A'], '#f00'), cable('b', ['A', 'B'], '#0f0')];
    const arG = groupCables(els), enG = groupCables(els, EN);
    expect(enG.scopes.map((s) => [s.key, s.kind, s.cableIds])).toEqual(arG.scopes.map((s) => [s.key, s.kind, s.cableIds]));
    expect(enG.scopes[0].label).toBe('Transformer 1');
    expect(arG.scopes[0].label).toBe('محول 1');
    expect(cableLabelParts(els, els[3] as CableElement, poleNamer(els, EN), EN)).toEqual({ ends: 'Transformer 1 ← Pole 1', spans: '1 section' });
  });

  it('the proposed subscriber texts from utils follow the language', () => {
    expect(proposalLoadText({ variant: 'square', label: '0', count: 1 })).toBe('حمل غير صالح');
    useLocale.getState().setLocale('en');
    expect(proposalLoadText({ variant: 'square', label: '0', count: 1 })).toBe('Invalid load');
    expect(proposalLoadText({ variant: 'square', label: '63', count: 1 })).toBe('3φ 63 A');
  });

  it('no visible text is written into the code of these screens', () => {
    for (const f of ['LoadReportModal.tsx', 'CableColorBar.tsx', 'ProposedConsumerSheet.tsx']) {
      const c = code(f);
      expect(c, f).not.toMatch(ARABIC);
      expect(c, f).not.toMatch(/(aria-label|title|placeholder)="[^"]*[A-Za-z]/);
      expect(c, f).not.toMatch(/>\s*[A-Z][a-z]+( [A-Za-z]+)*\s*</);
    }
  });
});
