import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Toolbar } from '../Toolbar';
import { SymbolsPanel } from '../SymbolsPanel';
import { FloatingHistoryControls } from '../FloatingHistoryControls';

// Four tools removed from the interface: the statistics (load report) button of the top toolbar, the
// curve (arc) tool of the left bar, the pencil (free draw) and the shapes tool of the floating bar.
// Every other button stays, in its order, with no separator left over.
const ids = (html: string, attr: string) => [...html.matchAll(new RegExp(`${attr}="([\\w-]+)"`, 'g'))].map((m) => m[1]);
const seps = (html: string) => (html.match(/ui-sep-[hv]/g) ?? []).length;

describe('removed tools', () => {
  const g = globalThis as { window?: unknown };
  const had = 'window' in g;
  beforeAll(() => { if (!had) g.window = { innerWidth: 390, innerHeight: 844, addEventListener: () => {}, removeEventListener: () => {} }; });
  afterAll(() => { if (!had) delete g.window; });

  it('top toolbar: no statistics button; the others in their order', () => {
    const html = renderToStaticMarkup(<Toolbar />);
    expect(ids(html, 'data-toolbar-tool')).toEqual(['projects', 'share', 'fullScreen', 'select', 'cable', 'cable_straight', 'transformer', 'voltageDrop', 'cableLibrary', 'deleteSelected']);
    expect(html).not.toContain('lucide-chart-column');
    expect(html).not.toContain('lucide-bar-chart');
    expect(seps(html)).toBe(2); // file | draw | info
  });
  it('left bar: no curve (arc) tool; text and the symbols in their order', () => {
    const html = renderToStaticMarkup(<SymbolsPanel />);
    expect(ids(html, 'data-symbol-tool')).toEqual(['text', 'consumer-circle', 'consumer-square', 'lv-pole', 'mv-pole', 'transformer', 'lattice-iron-pole', 'distribution-box', 'small-dot-pole']);
    expect(html).not.toContain('lucide-spline');
  });
  it('floating bar: no pencil and no shapes tool (nor their menu); undo, redo, minimize, one separator', () => {
    const html = renderToStaticMarkup(<FloatingHistoryControls />);
    expect(ids(html, 'data-history-action')).toEqual(['undo', 'redo', 'minimize']);
    expect(html).not.toContain('data-shape=');
    expect(html).not.toContain('lucide-pencil');
    expect(html).not.toContain('lucide-shapes');
    expect(seps(html)).toBe(1);
  });
});
