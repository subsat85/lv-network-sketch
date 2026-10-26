import React from 'react';
import type { TransformerTableElement } from '../types/drawing';
import type { TKey, TParams } from '../i18n';

// The transformer information table as drawn on the drawing (SketchCanvas), in the share preview and
// so in the PDF (PreviewCanvas): one drawing, one set of sizes, for both. Interaction (select, drag,
// zoom buttons, selection outline, undo / redo) stays in SketchCanvas around it.
//
// Sizes, in table units (× the table's own `scale`, which is saved with it): width 300, header 48,
// one 25-high row per entry, a 25 margin under the last row. Texts follow the interface language;
// the table's saved data (transformerInfo) is only read, never changed.

type Translate = (key: TKey, params?: TParams) => string;
type TransformerInfo = TransformerTableElement['transformerInfo'];

export interface TransformerTableRow {
  label: string;
  value: string;
  /** the capacitor row (shown with its present / absent mark) */
  capacitor?: boolean;
}

export const TABLE_WIDTH = 300;
export const TABLE_HEADER = 48;
export const TABLE_ROW = 25;
export const TABLE_BOTTOM = 25;

/** the drawing's colours: a calm engineering blue on a light ground */
export const TABLE_COLORS = {
  frame: '#2f5d8a',
  header: '#e9f0f7',
  title: '#1f3b5c',
  label: '#1f3b5c',
  value: '#111827',
  rule: '#d6e1ec',
  body: '#ffffff',
} as const;

/** The rows, in their order: the same content as before, in the interface language. */
export const transformerTableRows = (info: TransformerInfo, t: Translate): TransformerTableRow[] => {
  const boxCount = parseInt(info.distributionBoxesCount) || 1;
  const hasPerBox = boxCount > 1 && !!info.perBoxCircuits && info.perBoxCircuits.length > 0;
  const installation = () => {
    switch (info.installationMethod) {
      case 'ground': return t('tfTable.ground');
      case 'hanging': return t('tfTable.hanging');
      case 'indoor': return t('tfTable.indoorRoom');
      default: return '';
    }
  };
  const lighting = () => {
    switch (info.lightingBox) {
      case 'indoor': return t('tfTable.indoor');
      case 'outdoor': return t('tfTable.outdoor');
      case 'none': return t('tfTable.none');
      default: return '';
    }
  };
  const rows: TransformerTableRow[] = [
    { label: t('tfTable.mainCable'), value: t('tfTable.mm2', { n: info.mainCable }) },
    { label: t('tfTable.lines'), value: info.mainLinesCount },
    { label: t('tfTable.lineType'), value: info.cableType === 'copper' ? t('tfTable.copper') : t('tfTable.aluminium') },
    { label: t('tfTable.boxes'), value: info.distributionBoxesCount },
  ];
  if (hasPerBox) {
    rows.push({ label: t('tfTable.perBox'), value: '' });
    info.perBoxCircuits!.forEach((box, i) => {
      rows.push({ label: t('tfTable.box', { n: i + 1 }), value: t('tfTable.boxValue', { used: box.circuits, empty: box.emptyCircuits }) });
    });
  } else {
    rows.push({ label: t('tfTable.circuits'), value: info.circuitsPerBox });
    rows.push({ label: t('tfTable.empty'), value: info.emptyCircuitsPerBox });
  }
  rows.push(
    { label: t('tfTable.installation'), value: installation() },
    { label: t('tfTable.type'), value: info.transformerType === 'public' ? t('tfTable.public') : t('tfTable.private') },
    { label: t('tfTable.boxInstallation'), value: info.boxInstallationMethod === 'ground' ? t('tfTable.ground') : t('tfTable.hanging') },
    { label: t('tfTable.lighting'), value: lighting() },
    { label: t('tfTable.capacitor'), value: info.capacitor === 'yes' ? t('tfTable.present') : t('tfTable.absent'), capacitor: true },
  );
  return rows;
};

/** The table's size in drawing units: the frame holds every row (header, rows, bottom margin). */
export const transformerTableSize = (rowCount: number, scale = 1) => ({
  width: TABLE_WIDTH * scale,
  height: (TABLE_HEADER + rowCount * TABLE_ROW + TABLE_BOTTOM) * scale,
});

/** The table itself, drawn at (0, 0); the caller places it (and, on the drawing, makes it interactive). */
export const TransformerTableSvg: React.FC<{ info: TransformerInfo; scale?: number; t: Translate }> = ({ info, scale = 1, t }) => {
  const rows = transformerTableRows(info, t);
  const { width, height } = transformerTableSize(rows.length, scale);
  const s = scale;
  const c = TABLE_COLORS;
  const title = info.transformerNumber ? t('tfTable.titleNumber', { n: info.transformerNumber }) : t('tfTable.title');
  const present = info.capacitor === 'yes';
  return (
    <g data-transformer-table-body>
      {/* light ground, then the header band, then the thin frame over both */}
      <rect x={0} y={0} width={width} height={height} rx={3 * s} fill={c.body} />
      <rect x={0} y={0} width={width} height={44 * s} rx={3 * s} fill={c.header} />
      <line x1={0} y1={44 * s} x2={width} y2={44 * s} stroke={c.frame} strokeWidth={1 * s} />
      <rect x={0} y={0} width={width} height={height} rx={3 * s} fill="none" stroke={c.frame} strokeWidth={1 * s} data-transformer-table-frame />

      {/* transformer symbol: two overlapping windings, in the frame colour */}
      <g transform={`translate(${24 * s}, ${22 * s})`} fill="none" stroke={c.frame} strokeWidth={1.5 * s}>
        <circle cx={-4 * s} cy={0} r={6 * s} />
        <circle cx={4 * s} cy={0} r={6 * s} />
      </g>

      <text x={width / 2 + 8 * s} y={26 * s} textAnchor="middle" fill={c.title} fontSize={15 * s} fontWeight="bold">{title}</text>

      {/* rows: same places and type sizes as before; thin rules between rows and between the two columns */}
      <g transform={`translate(${5 * s}, ${50 * s})`}>
        <line x1={145 * s} y1={0} x2={145 * s} y2={rows.length * TABLE_ROW * s} stroke={c.rule} strokeWidth={0.5 * s} />
        {rows.map((row, i) => (
          <g key={i} transform={`translate(0, ${i * TABLE_ROW * s})`}>
            {i < rows.length - 1 && <line x1={0} y1={TABLE_ROW * s} x2={290 * s} y2={TABLE_ROW * s} stroke={c.rule} strokeWidth={0.5 * s} />}
            <text x={8 * s} y={16 * s} fontSize={9 * s} fill={c.label} fontWeight="600">{row.label}</text>
            {row.capacitor ? (
              <g>
                <circle cx={165 * s} cy={12 * s} r={5 * s} fill={present ? '#22c55e' : '#ef4444'} />
                <text x={175 * s} y={16 * s} fontSize={9 * s} fill={present ? '#166534' : '#991b1b'} fontWeight="bold">{row.value}</text>
              </g>
            ) : (
              <text x={150 * s} y={16 * s} fontSize={9 * s} fill={c.value} fontWeight="700">{row.value}</text>
            )}
          </g>
        ))}
      </g>
    </g>
  );
};
