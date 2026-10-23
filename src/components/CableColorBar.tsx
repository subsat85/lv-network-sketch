import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CableElement, DrawingElement } from '../types/drawing';
import { ALL_SCOPE, cableLabelParts, colourGroups, groupCables } from '../utils/cableGroups';
import { normColor } from '../utils/network';
import { poleNamer } from '../utils/poleNames';
import { ChevronDown } from 'lucide-react';
import { ICON_SM } from './ui/icons';

// The floating colour bar at the bottom of the canvas: one rounded square per colour
// (with the number of cables of that colour), optionally limited to one transformer
// (cableGroups.ts — only where that relation is confirmed). Tapping a square lists its
// cables; tapping a cable selects it exactly as the old per-cable swatch did and closes the
// list (the drawing stays free to work on; the square keeps the active frame). A view
// only: nothing here changes a cable, an id or a saved field.

interface Props {
  elements: DrawingElement[];
  selectedId: string | null;
  onSelectCable: (id: string) => void;
}

/** what the grouping depends on (not the positions): it is only redone when this changes */
const topologyKey = (elements: DrawingElement[]) => JSON.stringify(elements.map((e) => {
  if (e.type === 'cable') { const c = e as CableElement; return ['c', c.id, c.poleIds, normColor(c.strokeColor), c.endLinks ?? null]; }
  if (e.type === 'symbol') return ['s', e.id, (e as any).symbolId, !!(e as any).modifiers?.vdSource];
  if (e.type === 'cable_arc') return ['a', e.id, (e as any).poleId, (e as any).from, (e as any).to];
  return null;
}).filter(Boolean));

const SCOPE_MENU = '\u0000scopes';
const plural = (n: number) => (n === 1 ? 'كيبل واحد' : n === 2 ? 'كيبلان' : `${n} كوابل`);

export const CableColorBar: React.FC<Props> = ({ elements, selectedId, onSelectCable }) => {
  const key = topologyKey(elements);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const grouping = useMemo(() => groupCables(elements), [key]);
  const [scope, setScope] = useState<string>(ALL_SCOPE);
  // what the small panel above the bar shows: a colour's cables, the scope choice, or nothing
  const [open, setOpen] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const scopeEntry = grouping.scopes.find((s) => s.key === scope);
  const activeScope = scopeEntry ? scope : ALL_SCOPE;
  const scopeIds = scopeEntry?.cableIds;
  const groups = useMemo(() => colourGroups(elements, scopeIds), [elements, scopeIds]);
  const scopesOpen = open === SCOPE_MENU;
  const openGroup = scopesOpen ? null : groups.find((g) => g.key === open) ?? null;
  const selected = elements.find((e) => e.id === selectedId && e.type === 'cable') as CableElement | undefined;
  const selectedColour = selected && (!scopeIds || scopeIds.includes(selected.id)) ? normColor(selected.strokeColor) : null;
  const name = useMemo(() => poleNamer(elements), [elements]);
  const cableCount = elements.reduce((n, e) => n + (e.type === 'cable' ? 1 : 0), 0);

  // a tap anywhere else closes the panel; the tap itself goes on (drawing, panning, zooming)
  useEffect(() => {
    if (!open) return;
    const onDown = (ev: PointerEvent) => { if (rootRef.current && !rootRef.current.contains(ev.target as Node)) setOpen(null); };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);
  useEffect(() => { if (open && !scopesOpen && !openGroup) setOpen(null); }, [open, scopesOpen, openGroup]);

  if (!cableCount) return null;
  const showScopes = grouping.scopes.some((s) => s.kind !== 'unassigned');
  const scopeItems = [{ key: ALL_SCOPE, label: 'الكل', n: cableCount }, ...grouping.scopes.map((s) => ({ key: s.key, label: s.label, n: s.cableIds.length }))];
  const current = scopeItems.find((s) => s.key === activeScope)!;
  const panel = 'ui-float pointer-events-auto w-[min(300px,calc(100vw-124px))] max-h-[min(34vh,220px)] overflow-y-auto overscroll-contain py-1';

  return (
    // kept clear of the tool columns at the sides of the canvas (they reach down to the bottom on a phone);
    // one row, as high as the old bar, so it takes no more of the drawing
    <div className="absolute bottom-safe-bottom left-0 right-0 py-2 px-[58px] flex justify-center pointer-events-none" data-cable-colour-bar>
      <div ref={rootRef} className="flex max-w-full flex-col items-center gap-1.5 pointer-events-none">
        {scopesOpen && (
          <div dir="rtl" role="menu" aria-label="مجموعات المحولات" data-scope-menu className={panel}>
            {scopeItems.map((s) => (
              <button key={s.key} type="button" role="menuitemradio" aria-checked={activeScope === s.key} data-scope={s.key}
                aria-label={`${s.label}: ${plural(s.n)}`}
                onClick={() => { setScope(s.key); setOpen(null); }}
                className={`flex min-h-[40px] w-full items-center justify-between gap-2 px-3 text-right text-[14px] text-ios-label active:bg-ios-fill ${activeScope === s.key ? 'bg-ios-blue/[0.10] font-semibold' : ''}`}>
                <span className="truncate">{s.label}</span>
                <span className="min-w-[22px] rounded-full bg-black/[0.08] px-1.5 text-center text-[12px] leading-[18px]">{s.n}</span>
              </button>
            ))}
          </div>
        )}
        {openGroup && (
          <div dir="rtl" role="listbox" aria-label={`كوابل اللون ${openGroup.color}`} data-cable-list={openGroup.key} className={panel}>
            <div className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-ios-secondary">
              <span className="h-3.5 w-3.5 flex-shrink-0 rounded-[4px] ring-1 ring-inset ring-black/10" style={{ backgroundColor: openGroup.color }} />
              <span>{plural(openGroup.cableIds.length)} · {openGroup.spans} مقاطع{activeScope !== ALL_SCOPE ? ` · ${current.label}` : ''}</span>
            </div>
            {openGroup.cableIds.map((id) => {
              const c = elements.find((e) => e.id === id) as CableElement;
              const isSel = selectedId === id;
              return (
                <button key={id} type="button" role="option" aria-selected={isSel}
                  onClick={() => { onSelectCable(id); setOpen(null); }}
                  className={`flex min-h-[40px] w-full items-center gap-2 px-3 text-right text-[14px] text-ios-label active:bg-ios-fill ${isSel ? 'bg-ios-blue/[0.10] font-semibold' : ''}`}
                  aria-label={`Select cable ${id}`} data-cable-item={id}>
                  <span className="h-1 w-5 flex-shrink-0 rounded-full" style={{ backgroundColor: c.strokeColor }} />
                  <span className="flex min-w-0 flex-col items-start py-1 leading-tight">
                    <span className="max-w-full truncate">{cableLabelParts(elements, c, name).ends}</span>
                    <span className="text-[12px] font-normal text-ios-secondary">{cableLabelParts(elements, c, name).spans}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="ui-float pointer-events-auto flex max-w-full items-center gap-2 overflow-x-auto no-scrollbar px-2 py-1.5" role="group" aria-label="ألوان الكوابل">
          {showScopes && (
            <>
              <button type="button" data-scope-toggle={activeScope} aria-haspopup="menu" aria-expanded={scopesOpen}
                aria-label={`المجموعة: ${current.label} (${plural(current.n)})`}
                onClick={() => setOpen(scopesOpen ? null : SCOPE_MENU)}
                className={`m-0.5 flex h-[30px] flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-[9px] px-2 text-[12px] font-medium ${activeScope === ALL_SCOPE ? 'bg-ios-fill text-ios-label' : 'bg-ios-blue text-white'}`}>
                <span dir="rtl">{current.label}</span>
                <ChevronDown {...ICON_SM} className={scopesOpen ? 'rotate-180' : ''} aria-hidden="true" />
              </button>
              <div className="ui-sep-v !mx-0" aria-hidden="true" />
            </>
          )}
          {groups.map((g) => {
            const isOpen = open === g.key, isActive = selectedColour === g.key;
            return (
              <button key={g.key} type="button" data-colour-group={g.key} aria-expanded={isOpen}
                aria-label={`لون ${g.color}: ${plural(g.cableIds.length)}`}
                onClick={() => {
                  if (isOpen) { setOpen(null); return; }
                  setOpen(g.key);
                  if (g.cableIds.length === 1) onSelectCable(g.cableIds[0]);
                }}
                className={`relative m-0.5 h-[30px] w-[30px] flex-shrink-0 rounded-[8px] ring-1 ring-inset ring-black/10 transition-transform duration-150 active:scale-90 focus:outline-none ${isActive ? 'cable-colour-active' : ''}`}
                style={{ backgroundColor: g.color, boxShadow: isActive ? '0 0 0 2px #fff, 0 0 0 4px #007AFF' : isOpen ? '0 0 0 2px #fff, 0 0 0 3px rgba(0,0,0,0.35)' : undefined }}>
                <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-white [text-shadow:0_0_2px_rgba(0,0,0,0.9),0_0_1px_rgba(0,0,0,0.9)]">{g.cableIds.length}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
