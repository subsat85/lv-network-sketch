import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { translate, type TKey, type TParams } from '../../i18n';
import type { DrawingElement } from '../../types/drawing';
import { EMPTY_BOX, elementBoxes, fitToPage, isEmptyBox, tableBoxes, unionBox } from '../pageFit';

// The share preview's page fit (and so the PDF): view transform only.

const AR = (k: TKey, p?: TParams) => translate('ar', k, p);
const W = 1240, H = 1754;
const info = (n: number) => ({ transformerNumber: 'T-1', mainCable: '300', mainLinesCount: '4', cableType: 'copper', distributionBoxesCount: String(n), circuitsPerBox: '4', emptyCircuitsPerBox: '1',
  perBoxCircuits: Array.from({ length: n }, () => ({ circuits: '4', emptyCircuits: '1' })), installationMethod: 'ground', transformerType: 'public', boxInstallationMethod: 'ground', lightingBox: 'none', capacitor: 'yes' });
const pole = (id: string, x: number, y: number) => ({ id, type: 'symbol', symbolId: 'lv-pole', x, y, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2 }) as DrawingElement;
const cable = (poleIds: string[]) => ({ id: 'c', type: 'cable', x: 0, y: 0, poleIds, cableIndex: 0, offset: 0, strokeColor: '#f00', fillColor: 'none', strokeWidth: 2 }) as DrawingElement;
const table = (x: number, y: number, n: number, scale = 1) => ({ id: 'tt', type: 'transformer_table', x, y, strokeColor: '#000', fillColor: 'white', strokeWidth: 2, scale, transformerInfo: info(n) }) as DrawingElement;
const placed = (f: { x: number; y: number; scale: number }, b: { minX: number; minY: number; maxX: number; maxY: number }) => ({ left: f.x + b.minX * f.scale, top: f.y + b.minY * f.scale, right: f.x + b.maxX * f.scale, bottom: f.y + b.maxY * f.scale });

describe('page fit', () => {
  it('a table counts with its whole frame (rows × scale)', () => {
    expect(tableBoxes([table(100, 200, 1)], AR)).toEqual([{ minX: 100, minY: 200, maxX: 400, maxY: 548 }]);
    expect(tableBoxes([table(0, 0, 3, 1.5)], AR)).toEqual([{ minX: 0, minY: 0, maxX: 450, maxY: 597 }]);
  });

  it('fallback extents: cables are not at 0, 0 (they follow their poles); poles with their radius; paths relative to x / y', () => {
    const els = [pole('A', 500, 600), pole('B', 900, 600), cable(['A', 'B']), { id: 'p', type: 'path', x: 1000, y: 1000, points: [{ x: 0, y: 0 }, { x: 50, y: 20 }], strokeColor: '#000', fillColor: 'none', strokeWidth: 2 } as DrawingElement];
    expect(elementBoxes(els, AR, 20).reduce(unionBox, EMPTY_BOX)).toEqual({ minX: 480, minY: 580, maxX: 1050, maxY: 1020 });
  });

  it('the content fits inside the page, proportions kept (one scale), centred', () => {
    const content = { minX: 0, minY: 0, maxX: 1000, maxY: 3000 };
    const f = fitToPage(content, W, H);
    const r = placed(f, content);
    expect(r.top).toBeGreaterThanOrEqual(0); expect(r.bottom).toBeLessThanOrEqual(H); expect(r.left).toBeGreaterThanOrEqual(0); expect(r.right).toBeLessThanOrEqual(W);
    expect((r.left + r.right) / 2).toBeCloseTo(W / 2, 6);
  });

  it('with the legend shown, the content (padding included) stays above the reserved band', () => {
    const content = { minX: 0, minY: 0, maxX: 1000, maxY: 3000 };
    const reserved = 90;
    const f = fitToPage(content, W, H, reserved);
    expect(placed(f, { ...content, maxY: content.maxY + 100 }).bottom).toBeLessThanOrEqual(H - reserved + 1e-9);
  });

  it('a small drawing is not blown up past 2×', () => {
    expect(fitToPage({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, W, H).scale).toBe(2);
  });

  it('empty content is recognised', () => {
    expect(isEmptyBox(EMPTY_BOX)).toBe(true);
    expect(isEmptyBox({ minX: 0, minY: 0, maxX: 0, maxY: 0 })).toBe(false);
  });

  it('the share preview measures the drawn content and the legend, and keeps the manual view controls', () => {
    const c = readFileSync(resolve(__dirname, '../../components/SharePreview.tsx'), 'utf8');
    expect(c).toContain('drawingRef.current?.getBBox()');
    expect(c).toContain('legendRef.current?.getBBox()');
    expect(c).toContain('<g ref={drawingRef} transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale}) rotate(${transform.rotation})`}>');
    expect(c).toContain('const handleReset = fitToPage;');
    // «Reset» re-applies the fit measured when the preview opened (the same place every time)
    expect(c).toContain('if (fitRef.current) { setTransform({ ...fitRef.current, rotation: 0 }); return; }');
    // the manual zoom is still there (it now turns around the drawing's centre: viewTransform.test.ts)
    expect(c).toContain('const handleZoomIn = () => zoomBy(1.1);');
  });
});
