import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve, sep } from 'path';
import type { CableElement, ConsumerElement, DistanceFlag, DrawingElement, ElectricalSettings } from '../../types/drawing';
import { goldenCases, goldenTreeCases, type GoldenCase } from '../../utils/__tests__/vdGoldenNetworks';
import { serializeProject, validateProjectFile } from '../../utils/projectSerialization';
import { runStudy, studyWith } from '../index';
import type { ProjectDocument } from '../model';

// E1: the core never writes to the drawing document, gives the same result every time,
// and is not imported by the app. If a test here fails because of the EXISTING engine
// (a TypeError thrown in src/utils/network.ts or voltageDrop.ts), E1 stops: the existing
// engine is not changed and the inputs are not copied to hide it.

const CASES = [...goldenCases(), ...goldenTreeCases()];
const withVariants = (g: GoldenCase): { g: GoldenCase; settings: ElectricalSettings }[] => [
  { g, settings: g.settings },
  { g, settings: { ...g.settings, loadModel: 'constant-power' } },
  { g, settings: { ...g.settings, singlePhaseMode: g.settings.singlePhaseMode === 'worst' ? 'balanced' : 'worst' } },
];
/** a study case: a suggested split at an interior pole and a proposed subscriber */
const studied = (g: GoldenCase): GoldenCase => {
  const elements: DrawingElement[] = g.elements.map((e) => (e.type === 'cable' && e.poleIds.length >= 3 ? ({ ...e, suggestedSplits: [e.poleIds[1]] } as CableElement) : e));
  const cable = elements.find((e): e is CableElement => e.type === 'cable');
  if (cable) elements.push({ id: `prop-${g.name}`, type: 'consumer', x: 0, y: 0, poleId: cable.poleIds[0], color: cable.strokeColor, count: 1, variant: 'circle', label: '', strokeColor: '#000', fillColor: '#000', strokeWidth: 2, proposal: { status: 'proposed', connection: { cableId: cable.id, occurrence: 0 } } } as ConsumerElement);
  return { ...g, elements, settings: { ...g.settings, studySuggestedSplits: true, studyProposedConsumers: true } };
};
const flagsOf = (g: GoldenCase): Record<string, DistanceFlag> => Object.fromEntries(Object.keys(g.distances).slice(0, 1).map((k) => [k, { estimated: true }]));
const docOf = (g: GoldenCase, electrical: ElectricalSettings = g.settings): ProjectDocument =>
  ({ elements: g.elements, connectionDistances: g.distances, distanceFlags: flagsOf(g), electrical });

/** Object.freeze on every object and array reachable from v. */
const deepFreeze = <T>(v: T): T => {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
};
/** A full serialisation: Map / Set in insertion order, NaN, ±Infinity and −0 kept apart. */
const serial = (v: unknown) => JSON.stringify(v, (_k, x) => {
  if (x instanceof Map) return ['Map', [...x.entries()]];
  if (x instanceof Set) return ['Set', [...x]];
  if (typeof x === 'number' && (!Number.isFinite(x) || Object.is(x, -0))) return `number:${Object.is(x, -0) ? '-0' : String(x)}`;
  if (x === undefined) return 'undefined';
  return x;
});

describe('N1. deep-frozen document: runStudy and studyWith write nothing (a write throws in strict mode)', () => {
  it('the freeze really blocks writes here', () => {
    const o = deepFreeze({ a: [{ b: 1 }], s: [2, 1] });
    expect(() => { (o.a[0] as { b: number }).b = 2; }).toThrow(TypeError);
    expect(() => { (o.a as unknown[]).push(1); }).toThrow(TypeError);
    // (a one-element array sorts without writing; two unsorted elements must be swapped)
    expect(() => { (o.s as number[]).sort(); }).toThrow(TypeError);
  });
  it.each([['golden', CASES], ['studies', CASES.map(studied)]] as const)('%s networks, with constant power and both modes', (_n, cases) => {
    let runs = 0;
    for (const base of cases) for (const { g, settings } of withVariants(base)) {
      const doc = deepFreeze(docOf(g, settings));
      expect(() => runStudy(doc), g.name).not.toThrow();
      expect(() => studyWith(doc, deepFreeze({ ...settings })), g.name).not.toThrow();
      runs++;
    }
    expect(runs).toBe(cases.length * 3);
  });
});

describe('N2. not frozen: the document is the same after the calculation', () => {
  it('structuredClone before = the document after', () => {
    for (const base of [...CASES, ...CASES.map(studied)]) for (const { g, settings } of withVariants(base)) {
      const doc = docOf(g, settings);
      const before = structuredClone(doc);
      const text = JSON.stringify(doc);
      runStudy(doc);
      studyWith(doc, settings);
      expect(doc).toEqual(before);
      expect(JSON.stringify(doc)).toBe(text);
    }
  });
});

describe('N3. the same document gives the same result', () => {
  it('two calls, serialised in full, are identical', () => {
    for (const base of [...CASES, ...CASES.map(studied)]) for (const { g, settings } of withVariants(base)) {
      const doc = docOf(g, settings);
      expect(serial(studyWith(doc, settings))).toBe(serial(studyWith(doc, settings)));
      expect(serial(runStudy(doc))).toBe(serial(runStudy(doc)));
    }
  });
});

const ENGINE_DIR = resolve(__dirname, '..');
const SRC_DIR = resolve(ENGINE_DIR, '..');
const filesUnder = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? filesUnder(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
});

describe('N4. the core\'s own source: no randomness, no clock, no UI', () => {
  it('src/engine (tests excluded)', () => {
    const files = filesUnder(ENGINE_DIR).filter((f) => relative(ENGINE_DIR, f).split(sep).includes('__tests__') === false);
    expect(files.map((f) => relative(ENGINE_DIR, f)).sort()).toEqual(['adapter.ts', 'index.ts', 'issues.ts', 'model.ts', 'solver.ts', join('solvers', 'legacy.ts'), 'version.ts',
      ...['index.ts', 'version.ts', 'quantity.ts', 'assumptions.ts', 'complex.ts', join('catalogue', 'schema.ts'), join('catalogue', 'entries.ts'), join('catalogue', 'resolve.ts'), 'phases.ts', 'model.ts', 'build.ts', 'sweep.ts', 'losses.ts', 'limits.ts'].map((f) => join('e2', f))].sort());
    for (const f of files) {
      const code = readFileSync(f, 'utf8');
      expect(code, f).not.toMatch(/Math\.random|Date\.now|new Date\(/);
      expect(code, f).not.toMatch(/from\s+['"][^'"]*\/(store|components)\//);
      expect(code, f).not.toMatch(/from\s+['"]react(-dom)?['"]/);
      expect(code, f).not.toMatch(/__tests__/);
    }
  });
});

// N5 — approved exception (E2 UI integration, decision D-A): exactly ONE file of the app,
// src/utils/e2Presentation.ts, may import the core, and only E2 (src/engine/e2…). No other
// file imports src/engine, and no file outside src/engine imports E1 (src/engine/*.ts).
const N5_E2_ADAPTER = join('utils', 'e2Presentation.ts');
const engineSpecifiers = (code: string): string[] =>
  [...code.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]*\/engine(?:\/[^'"]*)?)['"]/g)].map((m) => m[1]);
describe('N5. the app does not import the core (one approved E2 adapter only)', () => {
  it('no file of src outside src/engine imports it, except the E2 presentation adapter', () => {
    // (compared with false instead of negated: Tailwind scans source text for class names)
    const outside = filesUnder(SRC_DIR).filter((f) => relative(SRC_DIR, f).startsWith(`engine`) === false);
    expect(outside.length).toBeGreaterThan(50);
    const importers = outside.filter((f) => /(from|import)\s*\(?\s*['"][^'"]*\/engine(\/[^'"]*)?['"]/.test(readFileSync(f, 'utf8')));
    expect(importers.map((f) => relative(SRC_DIR, f))).toEqual([N5_E2_ADAPTER]);
  });
  it('the adapter imports E2 only, never E1', () => {
    const specs = engineSpecifiers(readFileSync(join(SRC_DIR, N5_E2_ADAPTER), 'utf8'));
    expect(specs.length).toBeGreaterThan(0);
    for (const s of specs) expect(s, s).toMatch(/^\.\.\/engine\/e2(\/[^/]+)*$/);
  });
});

describe('6.5 a project file: validate → runStudy → save gives the same file', () => {
  it('golden networks as exported projects', () => {
    const style = { strokeColor: '#000000', fillColor: 'transparent', strokeWidth: 2, fontSize: 16 };
    const strip = (json: string) => { const o = JSON.parse(json); delete o.metadata.exportedAt; return o; };
    for (const g of CASES.slice(0, 40)) {
      const file = serializeProject(g.elements, style, 1, 'circle', g.distances, {}, 'p1', 'test', undefined, undefined, g.settings, flagsOf(g));
      const v = validateProjectFile(JSON.parse(file));
      expect(v.ok, g.name).toBe(true);
      if (!v.ok) continue;
      const d = v.data;
      const save = () => serializeProject(d.elements, d.style, d.poleSizeScale, d.consumerVariant, d.connectionDistances, d.connectionLabelOffsets ?? {}, 'p1', 'test', d.distanceTextScale, d.consumerSizeScale, d.electrical, d.distanceFlags);
      const without = strip(save());
      runStudy({ elements: d.elements, connectionDistances: d.connectionDistances, distanceFlags: d.distanceFlags ?? {}, electrical: d.electrical! });
      expect(strip(save()), g.name).toEqual(without);
    }
  });
});
