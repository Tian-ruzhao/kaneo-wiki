import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { TableSizePicker } from "./table-size-picker";

const formatSize = (rows: number, cols: number) => `${rows} × ${cols}`;

function renderPicker() {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <TableSizePicker
      top={8}
      left={16}
      label="Insert table"
      formatSize={formatSize}
      onSelect={onSelect}
      onClose={onClose}
    />,
  );
  const dialog = view.getByRole("dialog", { name: "Insert table" });
  const cell = (rows: number, cols: number) => {
    const found = view.container.querySelector(
      `button[data-row="${rows}"][data-col="${cols}"]`,
    );
    if (!found) throw new Error(`cell ${rows}x${cols} missing`);
    return found as HTMLElement;
  };
  const highlightedCount = () =>
    view.container.querySelectorAll("button.is-highlighted").length;
  const sizeText = () =>
    view.getByTestId("table-picker-size").textContent ?? "";
  return {
    ...view,
    dialog,
    cell,
    highlightedCount,
    sizeText,
    onSelect,
    onClose,
  };
}

describe("TableSizePicker", () => {
  it("renders a 10 x 8 grid positioned like the slash menu", () => {
    const { container, dialog, unmount } = renderPicker();
    try {
      expect(
        container.querySelectorAll("button[data-row][data-col]").length,
      ).toBe(80);
      expect(dialog.style.top).toBe("8px");
      expect(dialog.style.left).toBe("16px");
    } finally {
      unmount();
    }
  });

  it("highlights cells on hover and reports the selected size on click", () => {
    const { cell, highlightedCount, sizeText, onSelect, unmount } =
      renderPicker();
    try {
      fireEvent.mouseEnter(cell(2, 4));
      expect(sizeText()).toBe("2 × 4");
      expect(highlightedCount()).toBe(8);
      fireEvent.click(cell(2, 4));
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith(2, 4);
    } finally {
      unmount();
    }
  });

  it("selects with Enter after moving the highlight with arrow keys", () => {
    const { dialog, sizeText, onSelect, unmount } = renderPicker();
    try {
      fireEvent.keyDown(dialog, { key: "ArrowRight" });
      fireEvent.keyDown(dialog, { key: "ArrowRight" });
      fireEvent.keyDown(dialog, { key: "ArrowDown" });
      expect(sizeText()).toBe("2 × 3");
      fireEvent.keyDown(dialog, { key: "Enter" });
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith(2, 3);
    } finally {
      unmount();
    }
  });

  it("closes on Escape", () => {
    const { dialog, onClose, onSelect, unmount } = renderPicker();
    try {
      fireEvent.keyDown(dialog, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onSelect).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });
});
