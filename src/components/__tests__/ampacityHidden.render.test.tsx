import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VoltageDropOverlay } from '../VoltageDropOverlay';
import { voltageView } from '../../utils/e2Presentation';
import { ampacityWarnings } from '../../utils/ampacity';
import { networkAnalysis } from '../../utils/networkAnalysis';
import type { DrawingElement } from '../../types/drawing';
import { network } from '../../utils/__tests__/networkAnalysis.fixture';

// The red «current above the limit» boxes are not drawn on the drawing space (the network analysis
// panel shows them); the voltage-drop marks are drawn exactly as before. ALL VALUES SYNTHETIC.

const d = network({ limit: 150 });
const view = voltageView(d);
const els = d.elements as DrawingElement[];
const draw = (currentWarnings?: boolean) => renderToStaticMarkup(
  <svg><VoltageDropOverlay elements={els} result={view} poleRadius={6} {...(currentWarnings === undefined ? {} : { currentWarnings })} /></svg>,
);

describe('drawing space: no red ampacity boxes', () => {
  it('the fixture has spans over their limit (the check still finds them)', () => {
    expect(ampacityWarnings(els, view).length).toBeGreaterThan(0);
    expect(draw()).toContain('data-vd-ampacity=');
  });
  it('with currentWarnings={false}: no red box, the voltage-drop marks identical', () => {
    const shown = draw(true), hidden = draw(false);
    expect(hidden).not.toContain('data-vd-ampacity');
    expect(hidden).not.toContain('#dc2626');
    // removing the red boxes leaves everything else exactly as drawn
    expect(hidden).toBe(shown.replace(/<g data-vd-ampacity=[^>]*>.*?<\/g>/g, ''));
    expect((hidden.match(/data-vd-badge=/g) ?? []).length).toBe((shown.match(/data-vd-badge=/g) ?? []).length);
    expect((hidden.match(/data-vd-badge=/g) ?? []).length).toBeGreaterThan(0);
  });
  it('the drawing (SketchCanvas) passes currentWarnings={false}; the export preview is unchanged', () => {
    const sketch = readFileSync('src/components/SketchCanvas.tsx', 'utf8');
    expect(sketch).toMatch(/<VoltageDropOverlay[^>]*currentWarnings=\{false\}/);
    const preview = readFileSync('src/components/PreviewCanvas.tsx', 'utf8');
    expect(preview).not.toContain('currentWarnings');
  });
  it('the over results are still in the analysis (cards and spans)', () => {
    const a = networkAnalysis(els, view);
    expect(a.overLoad).toBeGreaterThan(0);
    expect(a.cards.some((c) => c.loadStatus === 'over' && c.over.length > 0)).toBe(true);
  });
});
