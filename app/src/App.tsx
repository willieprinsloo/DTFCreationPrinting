import "./styles/tokens.css";
import "./styles/app.css";

export default function App() {
  return (
    <div className="app-shell">
      <header className="region topbar" data-testid="topbar">
        DTF Print Studio
      </header>
      <main className="region canvas-area" data-testid="canvas-area">
        Film canvas
      </main>
      <aside className="region properties-panel" data-testid="properties-panel">
        Properties
      </aside>
      <section className="region library-drawer" data-testid="library-drawer">
        Library
      </section>
      <footer className="region status-bar" data-testid="status-bar">
        Ready
      </footer>
    </div>
  );
}
