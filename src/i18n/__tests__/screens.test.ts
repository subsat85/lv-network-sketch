import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ar } from '../ar';
import { en } from '../en';
import { MESSAGES } from '../../utils/autosave';

// Phase 5 / batch A: the symbols column, shapes, the floating undo / redo panel, the full-screen
// buttons, the distance editor and the autosave notices.

const ARABIC = /[؀-ۿ]/;
const leaves = (o: unknown, p = ''): [string, string][] =>
  Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (v && typeof v === 'object' ? leaves(v, `${p}${k}.`) : [[`${p}${k}`, v as string]]));
const strip = (c: string) => c.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const code = (f: string) => strip(readFileSync(resolve(__dirname, '../..', f), 'utf8'));
const SECTIONS = ['symbols', 'shapes', 'history', 'fullscreen', 'distance', 'autosave'] as const;

describe('remaining screens, batch A', () => {
  it('the sections have the same keys in both languages, all filled; English has no Arabic', () => {
    for (const sec of SECTIONS) {
      expect(leaves(en[sec]).map(([k]) => k)).toEqual(leaves(ar[sec]).map(([k]) => k));
      for (const [k, v] of [...leaves(ar[sec]), ...leaves(en[sec])]) expect(v.trim().length, `${sec}.${k}`).toBeGreaterThan(0);
      for (const [k, v] of leaves(en[sec])) expect(v, `${sec}.${k}`).not.toMatch(ARABIC);
      for (const [k, v] of leaves(ar[sec])) expect(v, `${sec}.${k}`).not.toMatch(/كيبل|فولتية/);
    }
  });

  it('every autosave message has a text in both languages (the messages of autosave.ts are not changed)', () => {
    for (const k of Object.keys(MESSAGES)) {
      expect(ar.autosave, k).toHaveProperty(k);
      expect(en.autosave, k).toHaveProperty(k);
    }
    // the Arabic notice says the same as before, with the Arabic button names
    expect(ar.autosave.readFailed).toBe(MESSAGES.readFailed);
    expect(ar.autosave.invalid).toBe(MESSAGES.invalid);
    expect(ar.autosave.crashed).toBe(MESSAGES.crashed);
    expect(ar.autosave.detached).toBe(MESSAGES.detached);
  });

  it('every shape has a name', () => {
    for (const id of ['rectangle', 'circle', 'triangle', 'arrow', 'compass', 'curved_arrow']) {
      expect(ar.shapes, id).toHaveProperty(id);
      expect(en.shapes, id).toHaveProperty(id);
    }
  });

  it('no visible text is written into the code of these screens', () => {
    for (const f of ['components/SymbolsPanel.tsx', 'components/ShapesPanel.tsx', 'components/FloatingHistoryControls.tsx', 'components/AutosaveNotice.tsx']) {
      const c = code(f);
      expect(c, f).not.toMatch(ARABIC);
      expect(c, f).not.toMatch(/(aria-label|title|placeholder)="[^"]*[A-Za-z]/);
      expect(c, f).not.toMatch(/>\s*[A-Z][a-z]+( [A-Za-z]+)*\s*</);
    }
    // App: the full-screen buttons; SketchCanvas: the distance editor
    const app = code('App.tsx');
    expect(app).not.toMatch(/(aria-label|title)="[^"]*/);
    const canvas = code('components/SketchCanvas.tsx');
    const editor = canvas.slice(canvas.indexOf('{editingDistance && ('));
    expect(editor).not.toMatch(/>\s*(Edit Distance|Cancel|Save)\s*</);
    expect(editor).toContain("tCurrent('distance.save')");
  });
});
