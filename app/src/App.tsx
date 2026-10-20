import "./styles/tokens.css";
import "./styles/app.css";
import { TopBar } from "./features/topbar/TopBar";
import { PropertiesPanel } from "./features/properties/PropertiesPanel";
import { StatusBar } from "./features/status/StatusBar";
import { lazy, Suspense, useEffect, useState } from "react";
import { DtfClientProvider } from "./api/DtfClientContext";
import { LibraryDrawer } from "./features/library/LibraryDrawer";
import { useSettings } from "./state/settingsStore";
import { PreflightDialog } from "./features/preflight/PreflightDialog";
import { installCloseGuard } from "./features/sheets/closeGuard";
import { SettingsDialog } from "./features/settings/SettingsDialog";
import { uiStore, useUi } from "./state/uiStore";
import { installTheme } from "./state/theme";

installTheme();

// react-konva needs a real canvas; jsdom tests render the shell without it.
const SheetCanvas =
  import.meta.env.MODE === "test"
    ? null
    : lazy(() => import("./features/canvas/SheetCanvas").then((m) => ({ default: m.SheetCanvas })));

export default function App() {
  const settingsTab = useUi((s) => s.settingsTab);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [drawerCollapsed, setDrawerCollapsed] = useState(false);
  const drawerHeight = useSettings((s) => s.drawerHeightPx);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    try {
      installCloseGuard()
        .then((u) => (disposed ? u() : (unlisten = u)))
        .catch(() => {});
    } catch {
      // Not running inside Tauri (tests / browser preview).
    }
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  return (
    <DtfClientProvider>
    <div
      className="app-shell"
      style={{ "--drawer-h": `${drawerCollapsed ? 34 : drawerHeight}px` } as React.CSSProperties}
    >
      <header className="region topbar" data-testid="topbar">
        <TopBar onCreatePrn={() => setPreflightOpen(true)} onOpenSettings={() => uiStore.getState().openSettings()} />
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
      {preflightOpen && <PreflightDialog onClose={() => setPreflightOpen(false)} />}
      {settingsTab && (
        <SettingsDialog key={settingsTab} initialTab={settingsTab} onClose={() => uiStore.getState().closeSettings()} />
      )}
    </div>
    </DtfClientProvider>
  );
}
