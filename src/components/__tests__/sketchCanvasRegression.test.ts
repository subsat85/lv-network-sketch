import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { fileURLToPath } from 'url';
import path from 'path';
import { detectShape } from '../../utils/pathUtils';
import { useDrawingStore } from '../../store/drawingStore';
import type { PathElement, ShapeElement } from '../../types/drawing';

// Stage 5.1 regressions.
//
// Four handlers in SketchCanvas.tsx used names that do not exist
// (connectionStartPoleId, setConnectionStartPoleId, deleteElement) and threw a
// ReferenceError at runtime:
//   - tap on empty canvas with the Cable tool (also broke double-tap finish)
//   - selecting a cable from the bottom cable palette
//   - freehand stroke recognised as circle / rectangle / triangle
// There is no DOM test environment in this project, so the guard is the
// TypeScript checker itself: any unresolved identifier in SketchCanvas.tsx fails.
// The interactive flows are additionally checked in a real browser (see report).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('SketchCanvas.tsx has no unresolved runtime identifiers', () => {
  it('no "Cannot find name" diagnostics for values (TS2304 / TS2552)', () => {
    const configPath = path.join(root, 'tsconfig.app.json');
    const cfg = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, root);
    const file = path.join(root, 'src/components/SketchCanvas.tsx');
    const program = ts.createProgram([file], { ...parsed.options, noEmit: true });
    const sf = program.getSourceFile(file)!;
    // find the innermost node at a position
    const nodeAt = (pos: number): ts.Node => {
      let found: ts.Node = sf;
      const visit = (n: ts.Node) => { if (pos >= n.getStart(sf) && pos < n.getEnd()) { found = n; ts.forEachChild(n, visit); } };
      ts.forEachChild(sf, visit);
      return found;
    };
    const inTypePosition = (n: ts.Node) => { for (let p: ts.Node | undefined = n; p; p = p.parent) if (ts.isTypeNode(p)) return true; return false; };
    const unresolved = ts.getPreEmitDiagnostics(program, sf)
      .filter(d => (d.code === 2304 || d.code === 2552) && !inTypePosition(nodeAt(d.start ?? 0)))
      .map(d => {
        const { line } = sf.getLineAndCharacterOfPosition(d.start ?? 0);
        return `line ${line + 1}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
      });
    // Type-only names (e.g. a missing type import) do not exist at runtime and are
    // excluded; anything left here would throw a ReferenceError in the browser.
    expect(unresolved).toEqual([]);
  }, 60_000);
});

// ---- freehand recognition: the stroke shapes the editor converts ----
const circleStroke = (cx: number, cy: number, r: number) =>
  Array.from({ length: 44 }, (_, i) => ({ x: cx + r * Math.cos((i / 40) * 2 * Math.PI), y: cy + r * Math.sin((i / 40) * 2 * Math.PI) }));

describe('freehand shape recognition → path is replaced by a shape', () => {
  it('a closed round stroke is detected as a circle', () => {
    expect(detectShape(circleStroke(200, 200, 50)).type).toBe('circle');
  });
  it('store: deleting the freehand path and adding the shape leaves only the shape (the sequence the canvas runs)', () => {
    const initial = useDrawingStore.getState();
    useDrawingStore.setState({ ...initial, elements: [], history: [], redoStack: [] }, true);
    const pathEl: PathElement = { id: 'p1', type: 'path', x: 0, y: 0, points: circleStroke(200, 200, 50), strokeColor: '#000000', fillColor: 'transparent', strokeWidth: 2 };
    const s = useDrawingStore.getState();
    s.addElement(pathEl);
    const res = useDrawingStore.getState().deleteElement('p1');
    expect(res.ok).toBe(true);
    const shape: ShapeElement = { id: 's1', type: 'shape', shapeType: 'circle', x: 150, y: 150, width: 100, height: 100, strokeColor: '#000000', fillColor: 'transparent', strokeWidth: 2, rotation: 0, scaleX: 1, scaleY: 1 };
    useDrawingStore.getState().addElement(shape);
    const els = useDrawingStore.getState().elements;
    expect(els.map(e => `${e.type}:${e.id}`)).toEqual(['shape:s1']);
  });
});
