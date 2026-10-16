import { fireEvent, render } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import Color from "@tiptap/extension-color";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import Highlight from "@tiptap/extension-highlight";
import { TextStyle } from "@tiptap/extension-text-style";
import { CellSelection } from "@tiptap/pm/tables";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { shouldShowDocsTextBubble } from "./docs-editor";
import { DocsTextColorPicker } from "./docs-text-color-picker";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// jsdom lacks geometry APIs that ProseMirror calls when focusing the editor;
// stub the minimum so chain().focus() works in these tests.
{
  const rangeProto = Range.prototype as unknown as Record<string, unknown>;
  if (typeof rangeProto.getClientRects !== "function") {
    rangeProto.getClientRects = () => [] as unknown as DOMRectList;
  }
  if (typeof rangeProto.getBoundingClientRect !== "function") {
    rangeProto.getBoundingClientRect = () => new DOMRect();
  }
}

const editors: Editor[] = [];

afterEach(() => {
  while (editors.length > 0) {
    editors.pop()?.destroy();
  }
  document.body.innerHTML = "";
});

function makeEditor(content = "<p>hello world</p>") {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
    ],
    content,
  });
  editors.push(editor);
  // Select "hello" so colour commands have a range to apply to.
  editor.commands.setTextSelection({ from: 1, to: 6 });
  return editor;
}

function swatch(container: HTMLElement, kind: string, id: string) {
  const button = container.querySelector(
    `[data-color-swatch][data-color-kind="${kind}"][data-color-id="${id}"]`,
  );
  if (!button) throw new Error(`swatch missing: ${kind}/${id}`);
  return button as HTMLElement;
}

describe("DocsTextColorPicker", () => {
  it("opens a panel with the font and background sections", () => {
    const editor = makeEditor();
    const view = render(<DocsTextColorPicker editor={editor} />);
    try {
      fireEvent.click(
        view.container.querySelector('button[aria-label="docs:color.label"]')!,
      );
      const dialog = view.container.querySelector('[role="dialog"]');
      expect(dialog).not.toBeNull();
      expect(
        dialog?.querySelector('[aria-label="docs:color.fontColor"]'),
      ).not.toBeNull();
      expect(
        dialog?.querySelector('[aria-label="docs:color.backgroundColor"]'),
      ).not.toBeNull();
      expect(dialog?.textContent).toContain("docs:color.restoreDefault");
    } finally {
      view.unmount();
    }
  });

  it("paints the selected text with the picked font colour", () => {
    const editor = makeEditor();
    const view = render(<DocsTextColorPicker editor={editor} />);
    try {
      fireEvent.click(
        view.container.querySelector('button[aria-label="docs:color.label"]')!,
      );
      fireEvent.click(swatch(view.container, "font", "red"));
      expect(editor.getAttributes("textStyle").color).toBe("#DC2626");
      // The Color extension hands the hex to the DOM, which serializes it
      // as rgb in the style attribute.
      expect(editor.view.dom.innerHTML).toContain("rgb(220, 38, 38)");
      // The pressed state follows the mark.
      expect(
        swatch(view.container, "font", "red").getAttribute("aria-pressed"),
      ).toBe("true");
    } finally {
      view.unmount();
    }
  });

  it("paints the selected text with the picked background colour", () => {
    const editor = makeEditor();
    const view = render(<DocsTextColorPicker editor={editor} />);
    try {
      fireEvent.click(
        view.container.querySelector('button[aria-label="docs:color.label"]')!,
      );
      fireEvent.click(swatch(view.container, "background", "yellow-light"));
      expect(editor.getAttributes("highlight").color).toBe("#FEF9C3");
      expect(editor.view.dom.innerHTML).toContain("#FEF9C3");
    } finally {
      view.unmount();
    }
  });

  it("restore default removes both the font colour and the background", () => {
    const editor = makeEditor();
    const view = render(<DocsTextColorPicker editor={editor} />);
    try {
      fireEvent.click(
        view.container.querySelector('button[aria-label="docs:color.label"]')!,
      );
      fireEvent.click(swatch(view.container, "font", "red"));
      fireEvent.click(swatch(view.container, "background", "yellow-light"));
      expect(editor.getAttributes("textStyle").color).toBe("#DC2626");
      expect(editor.getAttributes("highlight").color).toBe("#FEF9C3");

      const restore = Array.from(
        view.container.querySelectorAll("button"),
      ).find((button) => button.textContent === "docs:color.restoreDefault");
      expect(restore).not.toBeUndefined();
      fireEvent.click(restore!);
      expect(editor.getAttributes("textStyle").color).toBeUndefined();
      expect(editor.getAttributes("highlight").color).toBeUndefined();
      expect(editor.view.dom.innerHTML).not.toContain("#DC2626");
    } finally {
      view.unmount();
    }
  });

  it("the default font swatch and the none background swatch clear their mark", () => {
    const editor = makeEditor();
    const view = render(<DocsTextColorPicker editor={editor} />);
    try {
      fireEvent.click(
        view.container.querySelector('button[aria-label="docs:color.label"]')!,
      );
      fireEvent.click(swatch(view.container, "font", "blue"));
      fireEvent.click(swatch(view.container, "background", "blue-light"));
      fireEvent.click(swatch(view.container, "font", "default"));
      expect(editor.getAttributes("textStyle").color).toBeUndefined();
      expect(editor.getAttributes("highlight").color).toBe("#DBEAFE");
      fireEvent.click(swatch(view.container, "background", "none"));
      expect(editor.getAttributes("highlight").color).toBeUndefined();
    } finally {
      view.unmount();
    }
  });

  it("supports arrow-key navigation and Escape closes the panel", () => {
    const editor = makeEditor();
    const view = render(<DocsTextColorPicker editor={editor} />);
    try {
      const trigger = view.container.querySelector(
        'button[aria-label="docs:color.label"]',
      )! as HTMLElement;
      fireEvent.click(trigger);
      const first = swatch(view.container, "font", "default");
      first.focus();
      expect(document.activeElement).toBe(first);
      fireEvent.keyDown(first, { key: "ArrowRight" });
      expect(document.activeElement).toBe(
        swatch(view.container, "font", "red"),
      );
      // Enter applies the focused swatch like a normal button.
      fireEvent.click(document.activeElement as HTMLElement);
      expect(editor.getAttributes("textStyle").color).toBe("#DC2626");
      fireEvent.keyDown(view.container.querySelector('[role="dialog"]')!, {
        key: "Escape",
      });
      expect(view.container.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    } finally {
      view.unmount();
    }
  });

  it("renders nothing for read-only editors", () => {
    const editor = makeEditor();
    editor.setEditable(false);
    const view = render(<DocsTextColorPicker editor={editor} />);
    try {
      expect(view.container.innerHTML).toBe("");
    } finally {
      view.unmount();
    }
  });
});

describe("shouldShowDocsTextBubble", () => {
  function makeTableEditor() {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      extensions: [
        StarterKit,
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
      ],
      content:
        "<table><tbody><tr><td>aa</td><td>bb</td></tr></tbody></table><p>after</p>",
    });
    editors.push(editor);
    return editor;
  }

  it("hides the text bubble for a table cell selection", () => {
    const editor = makeTableEditor();
    const cells: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableCell") cells.push(pos);
    });
    expect(cells.length).toBe(2);
    // A cell position points *at* the cell from inside its row (so
    // $pos.node(-1) is the table); resolving one deeper lands inside the
    // cell content and is not a valid CellSelection anchor.
    const anchor = editor.state.doc.resolve(cells[0]!);
    const head = editor.state.doc.resolve(cells[1]!);
    editor.view.dispatch(
      editor.state.tr.setSelection(new CellSelection(anchor, head)),
    );
    const { from, to } = editor.state.selection;
    expect(shouldShowDocsTextBubble(editor, from, to)).toBe(false);
  });

  it("shows the text bubble for a normal text selection", () => {
    const editor = makeTableEditor();
    let paragraph: { from: number; to: number } | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && node.textContent === "after") {
        paragraph = { from: pos + 1, to: pos + 1 + node.textContent.length };
      }
    });
    expect(paragraph).not.toBeNull();
    const range = paragraph!;
    editor.commands.setTextSelection({ from: range.from, to: range.to });
    const { from, to } = editor.state.selection;
    expect(shouldShowDocsTextBubble(editor, from, to)).toBe(true);
    // A collapsed cursor shows nothing.
    editor.commands.setTextSelection(range.from);
    expect(
      shouldShowDocsTextBubble(
        editor,
        editor.state.selection.from,
        editor.state.selection.to,
      ),
    ).toBe(false);
  });
});
