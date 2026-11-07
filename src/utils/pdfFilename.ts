import type { TKey } from '../i18n';
import type { Tr } from './vdLabels';

// The names of the three PDF exports (the drawing, the network analysis report, the full report): the
// project's name and what the file is, in the language of the interface — never «download».
//   «<project> - الرسم.pdf» · «<project> - تقرير تحليل الشبكة.pdf» · «<project> - التقرير الشامل.pdf»
//   a project with no name: «<what it is> 2026-11-07.pdf»

export type PdfKind = 'drawing' | 'report' | 'full';

const KIND_KEY: Record<PdfKind, TKey> = { drawing: 'share.fileDrawing', report: 'share.fileReport', full: 'share.fileFull' };

/** a name a file system accepts: no path or reserved characters, no control characters, trimmed */
export const safeFilePart = (s: string | undefined | null) =>
  (s ?? '').normalize('NFC').replace(/[/\\:*?"<>|]/g, '_').replace(/\p{Cc}/gu, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');

export const pdfFilename = (projectName: string | undefined | null, kind: PdfKind, t: Tr, d = new Date()): string => {
  const what = safeFilePart(t(KIND_KEY[kind]));
  const name = safeFilePart(projectName);
  if (name) return `${name} - ${what}.pdf`;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${what} ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.pdf`;
};
