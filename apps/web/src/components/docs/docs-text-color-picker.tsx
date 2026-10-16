import type { Editor } from "@tiptap/core";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  DOCS_BACKGROUND_COLORS,
  DOCS_FONT_COLORS,
  type DocsBackgroundColor,
  type DocsTextColor,
} from "./text-colors";

const SWATCH_COLUMNS = 8;

type DocsTextColorPickerProps = {
  editor: Editor;
  buttonClassName?: string;
};

/**
 * Feishu-style text colour control for the docs bubble menu. The toolbar
 * button shows an "A" with the active colour bar; the panel holds a font
 * colour grid, a background colour grid, and a restore-default action.
 * Everything runs through normal editor commands so Yjs syncs the marks to
 * every collaborator.
 */
export function DocsTextColorPicker({
  editor,
  buttonClassName,
}: DocsTextColorPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // Re-read the active marks whenever the selection or document changes so
  // the swatch pressed states never go stale while the panel is open.
  const [, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((tick) => tick + 1);
    editor.on("selectionUpdate", bump);
    editor.on("update", bump);
    return () => {
      editor.off("selectionUpdate", bump);
      editor.off("update", bump);
    };
  }, [editor]);

  // Escape anywhere in the control and outside clicks close the panel.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  if (!editor.isEditable) return null;

  const activeFontColor = editor.getAttributes("textStyle").color as
    | string
    | undefined;
  const activeBackgroundColor = editor.getAttributes("highlight").color as
    | string
    | undefined;
  const hasMark = Boolean(activeFontColor ?? activeBackgroundColor);

  const applyFontColor = (entry: DocsTextColor) => {
    // Default means plain theme text: remove the mark instead of painting
    // black so dark mode keeps working.
    if (entry.id === "default") {
      editor.chain().focus().unsetColor().run();
    } else {
      editor.chain().focus().setColor(entry.value).run();
    }
  };

  const applyBackgroundColor = (entry: DocsBackgroundColor) => {
    if (!entry.value) {
      editor.chain().focus().unsetHighlight().run();
    } else {
      editor.chain().focus().setHighlight({ color: entry.value }).run();
    }
  };

  const restoreDefault = () => {
    editor.chain().focus().unsetColor().unsetHighlight().run();
  };

  const focusSwatch = (direction: 1 | -1, columns: number) => {
    const swatches = Array.from(
      containerRef.current?.querySelectorAll<HTMLElement>(
        "[data-color-swatch]",
      ) ?? [],
    );
    if (swatches.length === 0) return;
    const current = swatches.indexOf(document.activeElement as HTMLElement);
    const next =
      current === -1
        ? direction === 1
          ? 0
          : swatches.length - 1
        : (current + direction * columns + swatches.length) % swatches.length;
    swatches[next]?.focus();
  };

  const handlePanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (
      !(event.target as HTMLElement | null)?.hasAttribute?.("data-color-swatch")
    ) {
      return;
    }
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        focusSwatch(1, 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        focusSwatch(-1, 1);
        break;
      case "ArrowDown":
        event.preventDefault();
        focusSwatch(1, SWATCH_COLUMNS);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusSwatch(-1, SWATCH_COLUMNS);
        break;
    }
  };

  return (
    <span ref={containerRef} className="relative inline-flex">
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="xs"
        className={cn(
          buttonClassName,
          hasMark && "bg-accent text-accent-foreground",
        )}
        aria-label={t("docs:color.label")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            setOpen(false);
          }
        }}
      >
        <span
          aria-hidden="true"
          className="flex flex-col items-center leading-none"
        >
          <span className="text-[13px] font-bold">A</span>
          <span
            className="mt-px h-1 w-3.5 rounded-full"
            style={{
              backgroundColor:
                activeFontColor ?? activeBackgroundColor ?? "currentColor",
            }}
          />
        </span>
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label={t("docs:color.label")}
          className="absolute top-full left-1/2 z-50 mt-1.5 w-64 -translate-x-1/2 rounded-lg border bg-popover p-3 shadow-lg"
          onKeyDown={handlePanelKeyDown}
        >
          <p className="text-muted-foreground text-xs">
            {t("docs:color.fontColor")}
          </p>
          <div
            role="group"
            aria-label={t("docs:color.fontColor")}
            className="mt-1.5 grid grid-cols-8 gap-1.5"
          >
            {DOCS_FONT_COLORS.map((entry) => {
              const selected =
                entry.id === "default"
                  ? !activeFontColor
                  : activeFontColor === entry.value;
              return (
                <button
                  key={entry.id}
                  type="button"
                  data-color-swatch
                  data-color-kind="font"
                  data-color-id={entry.id}
                  aria-label={t(entry.label)}
                  aria-pressed={selected}
                  title={t(entry.label)}
                  onClick={() => applyFontColor(entry)}
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full border border-border outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring",
                    selected &&
                      "ring-2 ring-ring ring-offset-1 ring-offset-popover",
                  )}
                  style={{ backgroundColor: entry.value }}
                />
              );
            })}
          </div>
          <p className="mt-3 text-muted-foreground text-xs">
            {t("docs:color.backgroundColor")}
          </p>
          <div
            role="group"
            aria-label={t("docs:color.backgroundColor")}
            className="mt-1.5 grid grid-cols-8 gap-1.5"
          >
            {DOCS_BACKGROUND_COLORS.map((entry) => {
              const selected = entry.value
                ? activeBackgroundColor === entry.value
                : !activeBackgroundColor;
              return (
                <button
                  key={entry.id}
                  type="button"
                  data-color-swatch
                  data-color-kind="background"
                  data-color-id={entry.id}
                  aria-label={t(entry.label)}
                  aria-pressed={selected}
                  title={t(entry.label)}
                  onClick={() => applyBackgroundColor(entry)}
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full border border-border outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring",
                    selected &&
                      "ring-2 ring-ring ring-offset-1 ring-offset-popover",
                  )}
                  style={
                    entry.value
                      ? { backgroundColor: entry.value }
                      : {
                          backgroundImage:
                            "linear-gradient(to top right, transparent calc(50% - 1px), var(--destructive) 50%, transparent calc(50% + 1px))",
                        }
                  }
                />
              );
            })}
          </div>
          <button
            type="button"
            onClick={restoreDefault}
            className="mt-3 w-full rounded-md px-2 py-1.5 text-center text-muted-foreground text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("docs:color.restoreDefault")}
          </button>
        </div>
      )}
    </span>
  );
}
