import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { installViewportFix } from "./utils/viewportFix";
import { initAutosave } from "./utils/autosave";
import { installHistoryGestureTracking } from "./store/drawingStore";
import { initLocale } from "./store/localeStore";

// <html lang/dir> from the saved interface language (Arabic by default).
initLocale();
installViewportFix();
// One undo step per pointer gesture (drag, stroke, …).
installHistoryGestureTracking();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Restore the last draft (if any), then keep saving it automatically.
void initAutosave();
