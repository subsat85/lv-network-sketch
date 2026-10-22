# Architecture — LV Network Sketch

## Project Overview
Electrical Network Field Sketch App - A touch-friendly application for sketching electrical networks in the field using React and SVG.

## Development Commands
- `npm install`: Install dependencies.
- `npm run dev`: Start development server.
- `npm run build`: Build for production.
- `npm run lint`: Run linting (if available).

## Architecture

### State Management
- **Zustand Store** (`src/store/drawingStore.ts`): Manages the application state including:
  - `elements`: Array of all drawing elements (paths, symbols, cables, text).
  - `connectionDistances`: Map of connection IDs (`minId_maxId`) to distance strings.
  - `tool`: Current active tool (draw, select, cable, etc.).
  - `style`: Current drawing style (color, width).
  - `history`: Undo stack.
  - `redoStack`: Redo stack.
  - `poleSizeScale`: Global scaling factor for pole symbols.
  - `distanceTextScale`: Global scaling factor for distance labels.

### Rendering
- **SVG-based** (`src/components/SketchCanvas.tsx`):
  - All elements are rendered as SVG components (`<path>`, `<circle>`, `<text>`, `<g>`).
  - **Layering**: Cables are rendered first (bottom layer), followed by other elements (top layer), then connection labels.
  - **Transformations**: Pan and Zoom are handled via a parent `<g>` transform.
  - **Gestures**: Custom pointer event handling for pinch-zoom and pan.
  - **Cable Rendering**: Cables are rendered with a "light zigzag" pattern (amplitude 2, wavelength 10) using `createZigzagPath` helper, while maintaining a straight-line hit area for easier selection.

### Utilities
- **`src/utils/svgHelpers.ts`**: Contains helper functions for SVG path generation, such as `createZigzagPath`.
- **`src/utils/cableLayout.ts`**:
  - Handles the geometry of "smart cables" that connect poles.
  - **Center Anchoring**: All cables visually originate from the pole center, then fan out to their offsets.
  - **Dynamic Centering**: 
    - Offsets are calculated **per segment** based on the number of cables sharing that specific connection.
    - Ensures the *bundle* of cables is always centered on the pole-to-pole axis.
    - If a cable branches off alone, it automatically snaps to the center (offset 0) for that branch.
    - **Ordering**: Preserves the relative order of cables based on their `cable.offset` property (used as a sorting key, not a physical offset).
  - **Independent Segments**: Instead of calculating intersections (which can be unstable), segments are drawn independently and connected by a "bridge" or "jog" at the pole. This ensures robust rendering even for sharp turns or offset changes.

### Key Components
- **`SketchCanvas.tsx`**: The core component. Handles:
  - Rendering loop.
  - Pointer events for drawing, selecting, and navigation.
  - "Smart placement" logic for consumers around poles.
  - Cable arrow rendering (visual overlays).
  - **Cable Interaction**: Handles segment clicks for distance annotation (opens numeric input modal).
- **`Toolbar.tsx`**: Tool selection UI.
  - **Scrolling**: Horizontally scrollable on small screens (`overflow-x-auto`, `no-scrollbar`).
  - **Layout**: Flex container with fixed-width items (`flex-shrink-0`) to prevent resizing.
- **`FloatingHistoryControls.tsx`**: Draggable floating widget for Undo/Redo.
  - **Features**: Drag-and-drop positioning, minimize/expand toggle, Undo/Redo buttons.
  - **Layout**: Vertical column with grip handle at top.
- **`StylePanel.tsx`**: Configuration for colors, stroke width, and global settings.
- **`SymbolsPanel.tsx`**: Selection of electrical symbols.

## Data Model (`src/types/drawing.ts`)
- **`DrawingElement`**: Discriminated union of:
  - `PathElement`: Freehand strokes.
  - `TextElement`: Text labels.
  - `SymbolElement`: Poles (LV/MV) and Transformers.
  - `CableElement`: Connects a sequence of poles (`poleIds`). Supports `arrowMode` ('none', 'start', 'end'), `cableType` ('overhead', 'ground').
  - `ConsumerElement`: Attached to a pole (`poleId`).
- **`ProjectData`**: Includes `elements`, `style`, `poleSizeScale`, `consumerVariant`, and `connectionDistances`.

## Project Management
- **Storage**: Uses `idb-keyval` (IndexedDB) to store projects locally.
- **Structure**:
  - `projects_meta`: List of project metadata (id, name, dates).
  - `project_{id}`: Full project data.
- **UI**: `ProjectManager` component handles listing, saving, loading, and creating projects.
- **Import/Export**:
  - **Export**: Serializes project state to JSON. Uses Native Share API (iOS/Android) or File System Access API (Desktop) to save the file.
  - **Import**: Reads JSON file via native picker and atomically replaces the store state.

## Share & Export
- **Share Preview**: A dedicated full-screen modal (`src/components/SharePreview.tsx`) that renders the drawing on an A4 page.
- **Features**:
  - **Preview**: Real-time preview of the drawing on an A4 canvas.
  - **Controls**: Zoom, Pan, and Rotate controls (buttons + gestures) to adjust the view before export.
  - **Export**: Generates a PDF or shares via native share sheet (mobile).
  - **Implementation**: Uses `html2canvas` to capture the preview and `jspdf` to generate the PDF.
- **Rendering**: Uses `PreviewCanvas` (stateless version of `SketchCanvas`) to render the drawing inside an SVG.
  - **Synchronization**: `PreviewCanvas` MUST be kept in sync with `SketchCanvas` rendering logic (symbols, modifiers, cables) to ensure the export matches the editor view.
    - **Transformer Geometry**: Two vertical circles with a rectangle to the right.
    - **Smart Placement**: `getSmartPlacement` logic for consumers must be identical in both components.
- **Gestures**: Supports pinch-to-zoom, rotation, and pan to adjust the drawing's position on the A4 page.
- **Export**:
  - **PDF**: Uses `html2canvas` (at 4x resolution) to capture the A4 container and `jspdf` to generate a high-quality PDF.
  - **Share**: Uses Web Share API (`navigator.share`) to share the generated PDF.

## Visual Logic
- **Cable Arrows**: Rendered as filled triangles at the start/end of cables.
  - **Direction**: Always point TOWARDS the pole center. Calculated from the vector of the cable segment intersecting the pole boundary.
  - **Position**: Tip touches the outer edge of the pole circle (intersection of cable path and pole circle).
  - **Size**: 
    - **Editor**: Constant screen-space size (8px / zoom).
    - **Print**: Constant world-space size (8 units).
  - **Logic**: Traces the cable path outward from the pole center to find the first intersection with the pole boundary.
- **Ground Cables**:
  - Rendered as dashed lines.
  - **Transformer Connection**: If a ground cable connects to a transformer, it terminates at the edge of the transformer's rectangular box instead of the pole center/circle.
- **Distance Annotations**:
  - **Single Label per Connection**: One label per connected pair of poles, regardless of cable count.
  - **Storage**: Stored in `connectionDistances` map in `DrawingStore` (key: `minId_maxId`).
  - **Placement**: Midpoint of the connection, offset perpendicularly to the right (relative to sorted IDs).
  - **Offset Logic**: Automatically increases based on the maximum cable offset on that connection to avoid overlap.
  - **Style**: Red text with white halo.
  - **Interaction**: Tap the label to edit the distance; tap a segment of the selected cable to open that span's properties (length + electrical data). An unset distance is shown as "1" and is treated as missing by the voltage-drop calculation.
- **Symbol Modifiers**:
  - **Tilted/Rusted/Proposed Replacement/Notes**:
    - **Storage**: `modifiers` field in `SymbolElement`.
    - **Rendering**: `ColumnModifiers` component renders these overlays inside the symbol's group.
    - **Interaction**: Context menu (tap on selected column) to toggle states.
    - **Proposed Replacement**: Red circular outline around the pole.
    - **Notes**: Draggable rounded rectangular boxes with dynamic arrows pointing to the column. 
      - **Style**: White or Light Blue background (configurable), light gray border.
      - **Interaction**: Tap/Click to edit, Drag to move. Optimized for touch.
      - **Disabled for transformers.**
    - **Rusted**: Centered red dot.
    - **Z-Order**: Modifiers are rendered *below* selection and rotation handles to ensure transformer controls remain accessible.
- **Proposed Poles**:
  - **Storage**: `isProposed` boolean flag on `SymbolElement`.
  - **Rendering**: Changes the stroke (LV) or fill (MV) color to Red.
  - **Interaction**: Toggle via "Proposed Pole" in context menu.
- **Midpoint Insertion**:
  - **Logic**: Placing a new symbol on an existing cable segment splits every cable that runs directly between those two poles (parallel cables share the route).
  - **Distance**: A recorded distance is split in half (e.g., 50 -> 25, 25) and assigned to the new connections; an unrecorded one stays unrecorded.
- **Subscriber Symbols (Consumers)**:
  - **Style Override**: MUST be hollow (outline-only, `fill="none"`).
  - **Color**: Outline and internal number must match `el.color`.
  - **Selection**: Highlights outline in blue, number also turns blue.
  - **Touch Interaction**: Includes a larger transparent hit area (44x44px) behind the visible shape to improve touch selection accuracy.
- **Color Palette**: Added Light Blue (`#38BDF8`) to the standard color options.

## Cable span properties and voltage drop (Stage 7)

Calculation code is independent of the UI and covered by unit tests (`src/utils/__tests__/`).

- **Span identity** (`src/utils/spanModel.ts`): every cable keeps `spanIds` aligned with `poleIds` and `spanProps` (keyed by span id) on the cable element itself, so parallel cables never share properties and the data travels through save / export / autosave / undo with the elements. `reconcileElements` runs inside the store's `mutate` and keeps ids / properties right when a pole list changes: unchanged spans keep their id, a split span copies its properties to both parts (marked `split`), merged spans keep identical properties (or the first span's, marked `merge-different`), and a span added while drawing copies the previous span's properties (marked `inherited`, a copy not a link). The span length is the drawing's distance for the pole pair.
- **Settings** (`ElectricalSettings`, `src/utils/electricalSettings.ts`): part of the document (`electrical` in the store, history, autosave, saved projects and exported files). 230/400 V, 5 %, 218/380 V are editable reference values; power factor and conductor temperature have no default.
- **Loads** (`src/utils/loads.ts`): the load-report rules in one place (single-phase 4 A; three-phase = label or 32 A); `LoadReportModal` and the calculation both use them.
- **Topology** (`src/utils/network.ts`): connection points per cable visit; same-colour cables are joined at a pole, Jumpers join the two ends they link, a supply pole (transformer or the pole marked `modifiers.vdSource`) joins everything at it. Each connected network gets a source (marked pole, else its only transformer), and must be a tree from it; loops, same-colour parallel spans, several sources / transformers are reported, not computed.
- **Voltage drop** (`src/utils/voltageDrop.ts`, `src/data/conductors.ts`): constant-current loads, ΔV = I(R cos φ + X sin φ)L per conductor, worst-case (or user-chosen balanced) handling of single-phase loads of unknown phase, R from IEC 60228 class 2 (max DC at 20 °C, temperature corrected) or entered per span, X entered per span. Missing data make the span and everything fed through it "not computable", with the missing items listed.
- **UI**: `SpanPropertiesSheet` (span editor with live check, plus the non-blocking hint while drawing), `VoltageDropPanel` (settings, results per network, report text), `VoltageDropOverlay` (badges at poles in the cable colour, status as a symbol; also drawn in the share / PDF preview when shown).
- **File format**: still written as version 1 (only optional fields were added). Version 2 files from branch `feature/vd` are read by `src/utils/projectMigration.ts`: span ids kept, its span records kept unchanged under `legacyV2` (not used), "?" distances → unset, its pole-to-pole `jumper` elements kept and drawn but not used by the calculation.

### Stage 7.8 corrections (after the Stage 7 audit)

- **Connections need structure, not only colour**: at an ordinary pole two same-colour cables are joined only if at least one of them starts or ends there (branch / continuation); two through-cables cross unjoined (warning); an end meeting several same-colour through-cables is "ambiguous" (not computed). A cable that only runs through a transformer pole is not taken as fed by it ("ambiguous" until the transformer is marked as the source, or the cable is drawn ending there). A pole marked as source feeds every cable at it.
- **Invalid loads**: a label number ≤ 0 or a count that is not a whole number ≥ 1 is invalid; the load report keeps its totals and lists them, the voltage-drop calculation does not compute the spans that carry them.
- **Provisional results**: a value that depends on a span under review, unconfirmed copied properties, an estimated length or impedances without a stated source is shown "≈… ⚑ تقديري — يحتاج مراجعة", never as a plain "within the limit".
- **Distances when a pole is placed on a span** (`src/utils/distances.ts`, store `splitConnectionDistance`, `distanceFlags`): the recorded distance is split into two exact decimal halves (33.3 → 16.65 + 16.65) marked *estimated* (shown "≈" on the drawing) whatever the cables' properties; text that is not a plain number is never turned into a distance; the old pair key is moved into the markers so it cannot come back stale. Typing a distance makes it measured (and removes the span's `split` mark). Deleting the pole restores the original value exactly when neither part was measured, otherwise sets the exact sum (estimated if a part was).
- **Merges** keep every original record in `mergedFrom` (`merge-different` / `merge-partial`) until the user reviews and saves the span.
- **Conductor data**: the IEC 60228 table is used only for ABC / underground cables and for a neutral whose material is given as plain aluminium or copper; bare conductors, unknown kinds and alloy neutrals need R / Rn entered. Values typed per span without a source make the result provisional.
- **Saved projects**: a saved version-2 project whose span records cannot be placed is not opened (message; nothing written).
- **Load model (not changed)**: loads are constant currents. With constant-power loads the current rises as the voltage falls; for one lumped load the drop becomes d' with v = (1 + √(1 − 4d))/2: 3 % → 3.10 %, 5 % → 5.28 %, 8 % → 8.77 %, 10 % → 11.27 %. Constant current therefore under-states the drop of constant-power loads by roughly the drop itself (relative), and over-states it for constant-impedance loads. Which model applies depends on the load mix — an engineering choice not recorded in the project data.

### Stage 7.9

- **Cable end links** (`CableElement.endLinks`, `network.ts`, `CableEndsDialog`): each cable end is `auto` (no field — the Stage 7.8 rule, so older projects give exactly the same results), `connected` (junction confirmed, not listed for review) or `isolated` (joined to nothing at that pole, transformers included; a network left without supply shows "no source"). An ambiguous junction stays ambiguous even when confirmed (no target is invented; use a Jumper). Junctions made by the auto rule are listed per network in the voltage-drop panel (with a link to the pole's dialog) and marked "⋈" on the drawing. The setting of an end is removed when that end moves to another pole (`adjustEndLinks`). Opened from the pole menu («ربط الكوابل عند هذا العمود»). Stored on the cable: saved, exported (still version 1), autosaved and undone with it.
- **Load model** (`ElectricalSettings.loadModel`): `constant-current` (default; absent in older projects = constant current) or `constant-power`. Constant power rescales each subscriber's current by Vph / V at its pole and recomputes the whole radial network until no pole voltage moves by more than 1 mV (at most 50 passes); otherwise "غير قابل للحساب: لم يتقارب". Spans that carry loads behind missing data are not computed under constant power (their voltage is unknown). The model is named in the panel, the text report and on the share / PDF page.
- **Proof that existing results did not change**: `src/utils/__tests__/vdGolden.test.ts` compares 240 generated networks (random networks with every kind of problem, and radial trees with complete data; 515 computed spans) against `fixtures/vd-golden-7_8.json`, recorded from the Stage 7.8 code before the 7.9 changes.

### Stage 7.12 — default span properties and the company cable table

- **Company cable table** (`src/data/conductors.ts`, `COMPANY_RX_OHM_PER_KM`): the company's approved R and X in Ω/km for aluminium and copper, 120 / 70 / 35 / 25 / 4 / 2.5 / 1.5 mm². These are the reference values of this project, used exactly as given (no temperature correction, not replaced by IEC values). The IEC 60228 table stays the fallback when a span has no R.
- **New spans** (`src/utils/spanDefaults.ts`, applied by the cable tool in `SketchCanvas`): a drawn span that gets no properties from its neighbour gets ABC, 3 phases + N (400/230 V), phase Al 120 mm², neutral Al 70 mm², 1 conductor per phase, R / X / Rn from the company table, source «كتالوج» — in the same undo step. The values are copied into the span. Existing spans, opened, imported and restored projects are never changed; the file format stays version 1 (only existing fields are used).
- **Span sheet**: changing the phase material or section updates R and X from the table only while they hold the table values (or are empty); a typed value is kept (with a note) until «استخدام قيم جدول الشركة» is pressed. A size that is not in the table leaves R / X empty (no guess).
- **Neutral resistance Rn**: from the company table by the neutral's own material and cross-section only, when that pair is in the table; never derived from the phase material or section. Without a reliable value (aluminium-alloy neutral, size not in the table, material not given) Rn stays empty or keeps the typed value, and the calculation lists it as missing.
- **Neutral reactance (assumption, unchanged)**: there is no separate Xn. The calculation uses the span's X (the phase reactance) for the neutral as well: Zn = Rn cos φ + X sin φ (`voltageDrop.ts`, `zN`).
