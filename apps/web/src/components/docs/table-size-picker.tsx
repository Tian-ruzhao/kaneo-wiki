import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export const TABLE_PICKER_MAX_COLS = 10;
export const TABLE_PICKER_MAX_ROWS = 8;

type TableSizePickerProps = {
  top: number;
  left: number;
  position?: "absolute" | "fixed";
  label: string;
  formatSize: (rows: number, cols: number) => string;
  onSelect: (rows: number, cols: number) => void;
  onClose: () => void;
};

/**
 * ONES-style grid for choosing a table size. Rendered in the same popover
 * shell (and the same caret-relative position) as the "/" slash menu so it
 * is never clipped by the docs scrolling pane.
 */
export function TableSizePicker({
  top,
  left,
  position = "absolute",
  label,
  formatSize,
  onSelect,
  onClose,
}: TableSizePickerProps) {
  const [highlight, setHighlight] = useState({ rows: 1, cols: 1 });
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Mirrors for the window key handler so it always sees fresh values.
  const highlightRef = useRef(highlight);
  highlightRef.current = highlight;
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const moveHighlight = useCallback((rows: number, cols: number) => {
    setHighlight({
      rows: Math.min(Math.max(1, rows), TABLE_PICKER_MAX_ROWS),
      cols: Math.min(Math.max(1, cols), TABLE_PICKER_MAX_COLS),
    });
  }, []);

  // Keyboard support without a tabIndex on the (non-interactive) dialog:
  // arrows move the highlight and Enter/Escape act while focus is on the
  // picker. Enter on a focused cell falls through to the native button
  // activation so it never double-inserts.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!root.contains(event.target as Node)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      const onCellButton =
        event.target instanceof HTMLElement &&
        event.target.hasAttribute("data-row");
      if (event.key === "Enter" && !onCellButton) {
        event.preventDefault();
        const current = highlightRef.current;
        selectRef.current(current.rows, current.cols);
        return;
      }
      const current = highlightRef.current;
      switch (event.key) {
        case "ArrowRight":
          event.preventDefault();
          moveHighlight(current.rows, current.cols + 1);
          break;
        case "ArrowLeft":
          event.preventDefault();
          moveHighlight(current.rows, current.cols - 1);
          break;
        case "ArrowDown":
          event.preventDefault();
          moveHighlight(current.rows + 1, current.cols);
          break;
        case "ArrowUp":
          event.preventDefault();
          moveHighlight(current.rows - 1, current.cols);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moveHighlight]);

  return (
    <div
      ref={rootRef}
      className="kaneo-tiptap-slash-menu kaneo-table-size-picker"
      style={{ top, left, position }}
      role="dialog"
      aria-label={label}
    >
      <div className="flex items-center justify-between gap-4 px-1 pb-1">
        <span className="kaneo-tiptap-slash-group-title">{label}</span>
        <span
          className="text-xs tabular-nums text-muted-foreground"
          aria-live="polite"
          data-testid="table-picker-size"
        >
          {formatSize(highlight.rows, highlight.cols)}
        </span>
      </div>
      <div
        className="grid gap-1 p-1"
        style={{
          gridTemplateColumns: `repeat(${TABLE_PICKER_MAX_COLS}, minmax(0, 1fr))`,
        }}
      >
        {Array.from({ length: TABLE_PICKER_MAX_ROWS }, (_, rowIndex) =>
          Array.from({ length: TABLE_PICKER_MAX_COLS }, (_, colIndex) => {
            const rows = rowIndex + 1;
            const cols = colIndex + 1;
            const highlighted =
              rows <= highlight.rows && cols <= highlight.cols;
            return (
              <button
                key={`${rows}x${cols}`}
                type="button"
                data-row={rows}
                data-col={cols}
                aria-label={formatSize(rows, cols)}
                className={cn(
                  "size-4 rounded-[3px] border",
                  highlighted
                    ? "is-highlighted border-primary bg-primary/60"
                    : "border-border bg-muted/40",
                )}
                onMouseEnter={() => setHighlight({ rows, cols })}
                onFocus={() => setHighlight({ rows, cols })}
                onMouseDown={(event) => {
                  // Keep editor focus so the insert lands at the caret.
                  event.preventDefault();
                }}
                onClick={() => onSelect(rows, cols)}
              />
            );
          }),
        )}
      </div>
    </div>
  );
}
