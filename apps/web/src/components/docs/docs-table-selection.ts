import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";

export type DocsTableCellAlign = "left" | "center" | "right";

/**
 * A rectangular cell range (drag or shift-click across cells) is a
 * CellSelection. A collapsed cursor inside a table is not.
 */
export function isCellSelection(editor: Editor): boolean {
  return editor.state.selection instanceof CellSelection;
}

/**
 * The docs table toolbar floats above the table whenever the selection is
 * inside one — a cell range, a collapsed cursor, or a node selection.
 * Read-only viewers never see table tooling.
 */
export function shouldShowDocsTableToolbar(editor: Editor): boolean {
  if (!editor.isEditable) return false;
  return editor.isActive("table");
}

/**
 * Merge needs a range of at least two distinct cells. This reads the
 * selection directly instead of `editor.can()`: the dry-run chain can sample
 * a transient mid-sync document in collaborative sessions and wrongly report
 * false, while clicking merge always runs against the current state (a
 * non-mergeable range simply no-ops there).
 */
export function canMergeCells(editor: Editor): boolean {
  if (!editor.isEditable) return false;
  const { selection } = editor.state;
  if (!(selection instanceof CellSelection)) return false;
  return selection.$anchorCell.pos !== selection.$headCell.pos;
}

/**
 * Split is only meaningful on a single spanning cell (colspan or rowspan >
 * 1): either a single-cell range sitting on one, or a collapsed cursor
 * inside one. Multi-cell ranges never split.
 */
export function canSplitCell(editor: Editor): boolean {
  if (!editor.isEditable) return false;
  const { selection } = editor.state;
  if (selection instanceof CellSelection) {
    if (selection.$anchorCell.pos !== selection.$headCell.pos) return false;
    const cell = selection.$anchorCell.nodeAfter;
    if (
      !cell ||
      (cell.type.name !== "tableCell" && cell.type.name !== "tableHeader")
    ) {
      return false;
    }
    return (cell.attrs.colspan ?? 1) > 1 || (cell.attrs.rowspan ?? 1) > 1;
  }
  const { $from } = selection;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      return (node.attrs.colspan ?? 1) > 1 || (node.attrs.rowspan ?? 1) > 1;
    }
  }
  return false;
}

/** Alignment of the cell holding the anchor (null when unset). */
export function selectedCellAlign(editor: Editor): DocsTableCellAlign | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      const align = node.attrs.align as unknown;
      return align === "left" || align === "center" || align === "right"
        ? align
        : null;
    }
  }
  return null;
}

/**
 * Escape collapses a cell range back to a text cursor inside the anchor
 * cell. Returns false when there is no cell range to clear.
 */
export function clearCellSelection(editor: Editor): boolean {
  const { selection } = editor.state;
  if (!(selection instanceof CellSelection)) return false;
  try {
    const tr = editor.state.tr.setSelection(
      TextSelection.near(selection.$anchorCell),
    );
    editor.view.dispatch(tr);
    editor.view.focus();
    return true;
  } catch {
    return false;
  }
}
