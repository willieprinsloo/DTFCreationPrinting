import "./styles/tokens.css";
import "./styles/app.css";
import { TopBar } from "./features/topbar/TopBar";
import { PropertiesPanel } from "./features/properties/PropertiesPanel";
import { StatusBar } from "./features/status/StatusBar";
import { lazy, Suspense } from "react";

// react-konva needs a real canvas; jsdom tests render the shell without it.
const SheetCanvas =
  import.meta.env.MODE === "test"
    ? null
    : lazy(() => import("./features/canvas/SheetCanvas").then((m) => ({ default: m.SheetCanvas })));

export default function App() {
  return (
    <div className="app-shell">
      <header className="region topbar" data-testid="topbar">
        <TopBar />
      </header>
      <main className="region canvas-area" data-testid="canvas-area">
        {SheetCanvas ? (
          <Suspense fallback={null}>
            <SheetCanvas />
          </Suspense>
        ) : (
          "Film canvas"
        )}
      </main>
      <aside className="region properties-panel" data-testid="properties-panel">
        <PropertiesPanel />
      </aside>
      <section className="region library-drawer" data-testid="library-drawer">
        Library
      </section>
      <footer className="region status-bar" data-testid="status-bar">
        <StatusBar />
      </footer>
    </div>
  );
}
