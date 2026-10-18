import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { installViewportFix } from "./utils/viewportFix";
import { initAutosave } from "./utils/autosave";

installViewportFix();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Restore the last draft (if any), then keep saving it automatically.
void initAutosave();
