import "./styles/tokens.css";
import "./styles/app.css";
import { TopBar } from "./features/topbar/TopBar";
import { PropertiesPanel } from "./features/properties/PropertiesPanel";
import { StatusBar } from "./features/status/StatusBar";
import { lazy, Suspense, useState } from "react";
import { DtfClientProvider } from "./api/DtfClientContext";
import { LibraryDrawer } from "./features/library/LibraryDrawer";
import { useSettings } from "./state/settingsStore";
import { SettingsDialog } from "./features/settings/SettingsDialog";

// react-konva needs a real canvas; jsdom tests render the shell without it.
const SheetCanvas =
  import.meta.env.MODE === "test"
    ? null
    : lazy(() => import("./features/canvas/SheetCanvas").then((m) => ({ default: m.SheetCanvas })));

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [drawerCollapsed, setDrawerCollapsed] = useState(false);
  const drawerHeight = useSettings((s) => s.drawerHeightPx);
  return (
    <DtfClientProvider>
    <div
      className="app-shell"
      style={{ "--drawer-h": `${drawerCollapsed ? 34 : drawerHeight}px` } as React.CSSProperties}
    >
      <header className="region topbar" data-testid="topbar">
        <TopBar onOpenSettings={() => setSettingsOpen(true)} />
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
        <LibraryDrawer collapsed={drawerCollapsed} onToggleCollapsed={() => setDrawerCollapsed((c) => !c)} />
      </section>
      <footer className="region status-bar" data-testid="status-bar">
        <StatusBar />
      </footer>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
    </DtfClientProvider>
  );
}
