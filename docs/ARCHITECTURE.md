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
  - **Interaction**: Tap label or segment to edit. Default "1".
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
  - **Logic**: Placing a new symbol on an existing cable segment automatically splits the cable.
  - **Distance**: The existing distance value is split in half (e.g., 50 -> 25, 25) and assigned to the new connections.
- **Subscriber Symbols (Consumers)**:
  - **Style Override**: MUST be hollow (outline-only, `fill="none"`).
  - **Color**: Outline and internal number must match `el.color`.
  - **Selection**: Highlights outline in blue, number also turns blue.
  - **Touch Interaction**: Includes a larger transparent hit area (44x44px) behind the visible shape to improve touch selection accuracy.
- **Color Palette**: Added Light Blue (`#38BDF8`) to the standard color options.
