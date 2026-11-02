import { describe, expect, it } from 'vitest';
import { translate, type Locale } from '../../i18n';
import { importCableNotice } from '../ProjectManager';

// The import report shown after importing a drawing file (ProjectManager). ALL VALUES ARE SYNTHETIC.

const tr = (l: Locale) => (k: Parameters<typeof translate>[1], p?: Parameters<typeof translate>[2]) => translate(l, k, p);
const ARABIC = /[؀-ۿ]/;

describe('the import report', () => {
  it('an old drawing linked to the default cable: what was cleared and how many sections were linked', () => {
    for (const l of ['ar', 'en'] as const) {
      const n = importCableNotice({ kind: 'old', cleared: 2, linked: 3, needDefault: false }, tr(l))!;
      expect(n.split('\n')).toEqual([translate(l, 'defaultCable.importCleared', { n: 2 }), translate(l, 'defaultCable.importLinked', { n: 3 })]);
      expect(n).not.toContain(translate(l, 'defaultCable.importNeedDefault'));
    }
  });
  it('an old drawing without a default cable: cleared, and the user is told to choose a default cable', () => {
    for (const l of ['ar', 'en'] as const) {
      const n = importCableNotice({ kind: 'old', cleared: 2, linked: 0, needDefault: true }, tr(l))!;
      expect(n.split('\n')).toEqual([translate(l, 'defaultCable.importCleared', { n: 2 }), translate(l, 'defaultCable.importNeedDefault')]);
    }
    expect(importCableNotice({ kind: 'old', cleared: 2, linked: 0, needDefault: true }, tr('ar'))).toMatch(ARABIC);
    expect(importCableNotice({ kind: 'old', cleared: 2, linked: 0, needDefault: true }, tr('en'))).not.toMatch(ARABIC);
  });
  it('a file kept as it is (library snapshots, or no cable data) shows nothing; nor does a missing report', () => {
    expect(importCableNotice({ kind: 'new', cleared: 0, linked: 0, needDefault: false }, tr('ar'))).toBeNull();
    expect(importCableNotice({ kind: 'none', cleared: 0, linked: 0, needDefault: false }, tr('en'))).toBeNull();
    expect(importCableNotice(undefined, tr('en'))).toBeNull();
  });
});
