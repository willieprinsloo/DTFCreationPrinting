import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
});
