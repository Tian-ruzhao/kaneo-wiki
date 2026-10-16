import { Editor } from "@tiptap/core";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import { CellSelection } from "@tiptap/pm/tables";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  canMergeCells,
  canSplitCell,
  clearCellSelection,
  isCellSelection,
  selectedCellAlign,
  shouldShowDocsTableToolbar,
} from "./docs-table-selection";

const editors: Editor[] = [];

afterEach(() => {
  while (editors.length > 0) {
    editors.pop()?.destroy();
  }
  document.body.innerHTML = "";
});

/** Headless editor with the same table stack the docs editor uses. */
function createTableEditor() {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: [
      StarterKit,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: "",
  });
  editors.push(editor);
  expect(editor.commands.insertTable({ rows: 3, cols: 3 })).toBe(true);
  return editor;
}

/** Document positions of every table cell/header, row by row. */
function cellPositions(editor: Editor): number[] {
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      positions.push(pos);
    }
  });
  return positions;
}

function countCells(editor: Editor): number {
  let count = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      count += 1;
    }
  });
  return count;
}

function selectedCellCount(editor: Editor): number {
  const { selection } = editor.state;
  if (!(selection instanceof CellSelection)) return 0;
  let count = 0;
  selection.forEachCell(() => {
    count += 1;
  });
  return count;
}

/**
 * Select a rectangular range the way a drag or shift-click does: anchor and
 * head are cell indexes (row-major). CellSelection points *at* the cells,
 * so the raw node positions are used, not positions inside the content.
 */
function selectCellRange(editor: Editor, anchor: number, head: number) {
  const cells = cellPositions(editor);
  const selection = CellSelection.create(
    editor.state.doc,
    cells[anchor]!,
    cells[head]!,
  );
  editor.view.dispatch(editor.state.tr.setSelection(selection));
}

describe("docs table cell selection", () => {
  it("selects a rectangular 2x2 range as a CellSelection", () => {
    const editor = createTableEditor();
    // Cells 0-2 are row one, 3-5 row two: corners 0 and 4 span a 2x2 block.
    selectCellRange(editor, 0, 4);

    expect(isCellSelection(editor)).toBe(true);
    expect(selectedCellCount(editor)).toBe(4);
  });

  it("reports a collapsed cursor as no cell selection", () => {
    const editor = createTableEditor();

    expect(isCellSelection(editor)).toBe(false);
    expect(canMergeCells(editor)).toBe(false);
    expect(canSplitCell(editor)).toBe(false);
  });

  it("enables merge only for a multi-cell range", () => {
    const editor = createTableEditor();

    selectCellRange(editor, 0, 0);
    expect(canMergeCells(editor)).toBe(false);

    selectCellRange(editor, 0, 4);
    expect(canMergeCells(editor)).toBe(true);
  });

  it("merges a 2x2 range into one cell spanning 2 rows and 2 columns", () => {
    const editor = createTableEditor();
    expect(countCells(editor)).toBe(9);
    selectCellRange(editor, 0, 4);

    expect(editor.chain().focus().mergeCells().run()).toBe(true);

    const merged: Array<{ colspan: unknown; rowspan: unknown }> = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
        if (node.attrs.colspan === 2 && node.attrs.rowspan === 2) {
          merged.push({ colspan: 2, rowspan: 2 });
        }
      }
    });
    expect(merged).toHaveLength(1);
    // Four cells collapse into one: nine become six.
    expect(countCells(editor)).toBe(6);
  });

  it("splits a merged cell back into four cells", () => {
    const editor = createTableEditor();
    selectCellRange(editor, 0, 4);
    editor.chain().focus().mergeCells().run();
    expect(countCells(editor)).toBe(6);
    expect(canSplitCell(editor)).toBe(true);

    expect(editor.chain().focus().splitCell().run()).toBe(true);

    expect(countCells(editor)).toBe(9);
  });

  it("clears a cell range back to a text cursor on Escape", () => {
    const editor = createTableEditor();
    selectCellRange(editor, 0, 4);
    expect(isCellSelection(editor)).toBe(true);

    expect(clearCellSelection(editor)).toBe(true);

    expect(isCellSelection(editor)).toBe(false);
    expect(editor.state.selection.empty).toBe(true);
  });

  it("does nothing when there is no cell range to clear", () => {
    const editor = createTableEditor();

    expect(clearCellSelection(editor)).toBe(false);
  });

  it("shows the toolbar inside a table for editors only", () => {
    const editor = createTableEditor();

    // Collapsed cursor inside the table: toolbar visible.
    expect(shouldShowDocsTableToolbar(editor)).toBe(true);

    // Drag range inside the table: toolbar visible.
    selectCellRange(editor, 0, 4);
    expect(shouldShowDocsTableToolbar(editor)).toBe(true);

    // Cursor outside the table: toolbar hidden.
    editor.commands.insertContentAt(0, {
      type: "paragraph",
      content: [{ type: "text", text: "outside" }],
    });
    editor.commands.setTextSelection(2);
    expect(shouldShowDocsTableToolbar(editor)).toBe(false);

    // Read-only viewers never see the toolbar, even inside a table.
    editor.setEditable(false);
    selectCellRange(editor, 0, 4);
    expect(shouldShowDocsTableToolbar(editor)).toBe(false);
  });

  it("aligns the selected cells through the cell attribute", () => {
    const editor = createTableEditor();
    selectCellRange(editor, 0, 4);
    expect(selectedCellAlign(editor)).toBeNull();

    expect(
      editor.chain().focus().setCellAttribute("align", "center").run(),
    ).toBe(true);

    expect(selectedCellAlign(editor)).toBe("center");
    const aligned = editor.view.dom.querySelectorAll(
      'td[style*="text-align: center"], th[style*="text-align: center"]',
    );
    // The whole 2x2 range carries the alignment.
    expect(aligned.length).toBe(4);
  });

  it("inserts a row below from a cell range", () => {
    const editor = createTableEditor();
    selectCellRange(editor, 0, 4);

    expect(editor.chain().focus().addRowAfter().run()).toBe(true);

    expect(editor.view.dom.querySelectorAll("tr")).toHaveLength(4);
  });
});
