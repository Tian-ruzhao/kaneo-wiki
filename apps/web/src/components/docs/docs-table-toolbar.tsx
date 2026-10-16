import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Bold,
  Columns3,
  Grid2x2X,
  Italic,
  Rows3,
  Strikethrough,
  TableCellsMerge,
  TableCellsSplit,
  Underline,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  canMergeCells,
  canSplitCell,
  selectedCellAlign,
  type DocsTableCellAlign,
} from "./docs-table-selection";

export type DocsTableToolbarLabels = {
  mergeCells: string;
  splitCell: string;
  addRowBefore: string;
  addRowAfter: string;
  addColumnBefore: string;
  addColumnAfter: string;
  deleteRow: string;
  deleteColumn: string;
  deleteTable: string;
  bold: string;
  italic: string;
  underline: string;
  strikethrough: string;
  alignLeft: string;
  alignCenter: string;
  alignRight: string;
};

const bubbleButtonClass = "kaneo-tiptap-bubble-btn";

/**
 * Feishu-style floating table toolbar for docs pages: merge/split, row and
 * column structure, text marks, and per-cell alignment in one compact row.
 * Table edits are normal ProseMirror transactions, so Yjs syncs them to
 * every collaborator automatically.
 */
export function DocsTableToolbar({
  editor,
  labels,
}: {
  editor: Editor;
  labels: DocsTableToolbarLabels;
}) {
  // Reactive toolbar state through the editor's external store. Plain reads
  // like `editor.can().mergeCells()` must not be memoized on the (stable)
  // editor instance: React Compiler would freeze them at mount and the merge
  // button would never enable. useEditorState re-selects after every
  // transaction, so the states below always reflect the live selection.
  const { mergeDisabled, splitDisabled, align, markActive } = useEditorState({
    editor,
    selector: ({ editor: snapshotEditor }) => ({
      mergeDisabled: !canMergeCells(snapshotEditor),
      splitDisabled: !canSplitCell(snapshotEditor),
      align: selectedCellAlign(snapshotEditor),
      markActive: {
        bold: snapshotEditor.isActive("bold"),
        italic: snapshotEditor.isActive("italic"),
        underline: snapshotEditor.isActive("underline"),
        strike: snapshotEditor.isActive("strike"),
      },
    }),
  });

  const toggleAlign = (value: DocsTableCellAlign) => {
    editor
      .chain()
      .focus()
      .setCellAttribute("align", align === value ? null : value)
      .run();
  };

  return (
    <span className="contents">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={bubbleButtonClass}
        title={labels.mergeCells}
        aria-label={labels.mergeCells}
        disabled={mergeDisabled}
        onClick={() => editor.chain().focus().mergeCells().run()}
      >
        <TableCellsMerge className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={bubbleButtonClass}
        title={labels.splitCell}
        aria-label={labels.splitCell}
        disabled={splitDisabled}
        onClick={() => editor.chain().focus().splitCell().run()}
      >
        <TableCellsSplit className="size-3.5" />
      </Button>
      <span className="kaneo-tiptap-bubble-separator" />
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={bubbleButtonClass}
        title={labels.addRowBefore}
        aria-label={labels.addRowBefore}
        onClick={() => editor.chain().focus().addRowBefore().run()}
      >
        <BetweenHorizontalStart className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={bubbleButtonClass}
        title={labels.addRowAfter}
        aria-label={labels.addRowAfter}
        onClick={() => editor.chain().focus().addRowAfter().run()}
      >
        <BetweenHorizontalEnd className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={bubbleButtonClass}
        title={labels.addColumnBefore}
        aria-label={labels.addColumnBefore}
        onClick={() => editor.chain().focus().addColumnBefore().run()}
      >
        <BetweenVerticalStart className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={bubbleButtonClass}
        title={labels.addColumnAfter}
        aria-label={labels.addColumnAfter}
        onClick={() => editor.chain().focus().addColumnAfter().run()}
      >
        <BetweenVerticalEnd className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={cn(bubbleButtonClass, "text-destructive")}
        title={labels.deleteRow}
        aria-label={labels.deleteRow}
        onClick={() => editor.chain().focus().deleteRow().run()}
      >
        <Rows3 className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={cn(bubbleButtonClass, "text-destructive")}
        title={labels.deleteColumn}
        aria-label={labels.deleteColumn}
        onClick={() => editor.chain().focus().deleteColumn().run()}
      >
        <Columns3 className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={cn(bubbleButtonClass, "text-destructive")}
        title={labels.deleteTable}
        aria-label={labels.deleteTable}
        onClick={() => editor.chain().focus().deleteTable().run()}
      >
        <Grid2x2X className="size-3.5" />
      </Button>
      <span className="kaneo-tiptap-bubble-separator" />
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={cn(
          bubbleButtonClass,
          markActive.bold && "bg-accent text-accent-foreground",
        )}
        title={labels.bold}
        aria-label={labels.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={cn(
          bubbleButtonClass,
          markActive.italic && "bg-accent text-accent-foreground",
        )}
        title={labels.italic}
        aria-label={labels.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={cn(
          bubbleButtonClass,
          markActive.underline && "bg-accent text-accent-foreground",
        )}
        title={labels.underline}
        aria-label={labels.underline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <Underline className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={cn(
          bubbleButtonClass,
          markActive.strike && "bg-accent text-accent-foreground",
        )}
        title={labels.strikethrough}
        aria-label={labels.strikethrough}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={cn(
          bubbleButtonClass,
          align === "left" && "bg-accent text-accent-foreground",
        )}
        title={labels.alignLeft}
        aria-label={labels.alignLeft}
        onClick={() => toggleAlign("left")}
      >
        <AlignLeft className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={cn(
          bubbleButtonClass,
          align === "center" && "bg-accent text-accent-foreground",
        )}
        title={labels.alignCenter}
        aria-label={labels.alignCenter}
        onClick={() => toggleAlign("center")}
      >
        <AlignCenter className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={cn(
          bubbleButtonClass,
          align === "right" && "bg-accent text-accent-foreground",
        )}
        title={labels.alignRight}
        aria-label={labels.alignRight}
        onClick={() => toggleAlign("right")}
      >
        <AlignRight className="size-3.5" />
      </Button>
    </span>
  );
}
