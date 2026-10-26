import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { ar } from '../ar';
import { en } from '../en';
import { useLocale } from '../../store/localeStore';
import { midPoleId, MID_POLE_REFUSED } from '../../utils/splitPoleId';
import { deletePoleCascade } from '../../utils/deletePole';
import { parseProjectFile } from '../../utils/projectSerialization';
import { planImport } from '../../utils/projectImport';
import type { DrawingElement } from '../../types/drawing';

// Batch 4 of phase 4: alert / confirm / prompt texts, including the messages that come from the
// store and the utils. They are made when the action happens, in the interface language.

const ARABIC = /[؀-ۿ]/;
const leaves = (o: unknown, p = ''): [string, string][] =>
  Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (v && typeof v === 'object' ? leaves(v, `${p}${k}.`) : [[`${p}${k}`, v as string]]));
const src = resolve(__dirname, '../..');
const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === '__tests__' ? [] : files(join(d, e.name))) : /\.tsx?$/.test(e.name) ? [join(d, e.name)] : []));

afterEach(() => useLocale.getState().setLocale('ar'));

describe('dialog texts', () => {
  it('dialogs has the same keys in both languages, all filled; English has no Arabic', () => {
    expect(leaves(en.dialogs).map(([k]) => k)).toEqual(leaves(ar.dialogs).map(([k]) => k));
    for (const [k, v] of [...leaves(ar.dialogs), ...leaves(en.dialogs)]) expect(v.trim().length, k).toBeGreaterThan(0);
    for (const [k, v] of leaves(en.dialogs)) expect(v, k).not.toMatch(ARABIC);
    for (const [k, v] of leaves(ar.dialogs)) expect(v, k).not.toMatch(/كيبل|فولتية|المحوّل/);
  });

  it('no alert / confirm / prompt anywhere in the app is given a written text', () => {
    for (const f of files(src)) {
      const c = readFileSync(f, 'utf8');
      expect(c, f).not.toMatch(/\b(alert|confirm|prompt)\(\s*['"`]/);
    }
  });

  it('the mid-pole refusal: the Arabic text is the one used before; it follows the language', () => {
    expect(MID_POLE_REFUSED).toBe('تعذّرت إضافة عمود على هذا المقطع: معرّفات عمودَي المقطع غير مألوفة (غالبًا من ملف مستورد)، ' +
      'فلا يمكن ضمان بقاء ترتيب الكوابل المتوازية وجهة رقم المسافة كما هي. لم يتغيّر شيء في الرسم.');
    expect(midPoleId('kp5', 'kp9', () => true)).toEqual({ ok: false, message: MID_POLE_REFUSED });
    useLocale.getState().setLocale('en');
    expect(midPoleId('kp5', 'kp9', () => true)).toEqual({ ok: false, message: en.dialogs.midPoleRefused });
  });

  it('a refused pole deletion (from the store) gives its reason in the interface language', () => {
    const els = [{ id: 't', type: 'text', x: 0, y: 0, text: 'x', strokeColor: '#000', fillColor: '#000', strokeWidth: 1 }] as unknown as DrawingElement[];
    const r = (id: string) => deletePoleCascade(els, {}, {}, id) as { ok: boolean; reason?: string };
    expect(r('none').reason).toBe('العمود غير موجود.');
    useLocale.getState().setLocale('en');
    expect(r('none').reason).toBe('Pole not found.');
    expect(r('t').reason).toBe('Selected element is not a pole.');
  });

  it('a file that cannot be imported is explained in the interface language, nothing else changes', async () => {
    const bad = JSON.stringify({ version: 1, elements: [{ type: 'symbol', id: 'p' }] });
    const arPlan = await planImport(bad);
    expect(arPlan.ok).toBe(false);
    expect((arPlan as { message: string }).message).toMatch(/^لم يتم الاستيراد، الملف غير صالح:\n• symbol "p": إحداثيات x\/y غير صالحة\./);
    useLocale.getState().setLocale('en');
    const enPlan = await planImport(bad);
    const m = (enPlan as { message: string }).message;
    expect(m.split('\n')[0]).toBe('Not imported, the file is not valid:');
    expect(m).toContain('• symbol "p": invalid x/y coordinates.');
    expect(m.split('\n').at(-1)).toBe('The current drawing and the saved projects were not changed.');
    expect(m).not.toMatch(ARABIC);
    expect(parseProjectFile('{').ok).toBe(false);
    expect((parseProjectFile('{') as { errors: string[] }).errors).toEqual(['The file is not valid JSON (it may be damaged or incomplete).']);
  });
});
