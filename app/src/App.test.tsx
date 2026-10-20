import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("./platform/tauri", () => ({
  loadCredentials: vi.fn(async () => ({ email: "a@b.c", password: "pw" })),
  saveCredentials: vi.fn(async () => {}),
  clearCredentials: vi.fn(async () => {}),
}));
vi.mock("./state/persist", async (orig) => {
  const m = await orig<typeof import("./state/persist")>();
  return { ...m, createTauriStore: () => m.createMemoryStore() };
});
import App from "./App";

const ids = [
  "topbar",
  "canvas-area",
  "properties-panel",
  "library-drawer",
  "status-bar",
];

describe("App", () => {
  it("renders the five Layout B regions", () => {
    render(<App />);
    for (const id of ids) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    const canvas = screen.getByTestId("canvas-area");
    const drawer = screen.getByTestId("library-drawer");
    expect(
      canvas.compareDocumentPosition(drawer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("opens the settings dialog from the gear", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeInTheDocument();
  });
});
