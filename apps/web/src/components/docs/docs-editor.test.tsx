import { fireEvent, render, waitFor } from "@testing-library/react";
import { Extension } from "@tiptap/core";
import TaskItem from "@tiptap/extension-task-item";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";
import type { DocsPage } from "@/hooks/queries/page/use-get-pages";
import { DocsEditor } from "./docs-editor";

const mocks = vi.hoisted(() => ({
  t: (key: string) => key,
  config: { hasImageUploads: true } as { hasImageUploads: boolean } | undefined,
  uploadPageImage: vi.fn(),
  toastInfo: vi.fn(),
  toastError: vi.fn(),
  toastLoading: vi.fn(),
  toastDismiss: vi.fn(),
}));

// Same approach as task-description.test.tsx: replace only the extensions that
// pull in browser-only machinery with real (inert) Tiptap extensions, so
// `useEditor` still builds a genuine editor (including the real Yjs
// Collaboration binding) instead of a stub.
function inert(name: string) {
  return Extension.create({ name });
}

// jsdom lacks geometry APIs that ProseMirror calls when focusing the editor
// and resolving caret coordinates; stub the minimum so focus, selection, and
// slash-menu positioning paths can be exercised.
{
  const rangeProto = Range.prototype as unknown as Record<string, unknown>;
  if (typeof rangeProto.getClientRects !== "function") {
    rangeProto.getClientRects = () => [] as unknown as DOMRectList;
  }
  if (typeof rangeProto.getBoundingClientRect !== "function") {
    rangeProto.getBoundingClientRect = () => new DOMRect();
  }
  const textProto = Text.prototype as unknown as Record<string, unknown>;
  if (typeof textProto.getClientRects !== "function") {
    textProto.getClientRects = () => [] as unknown as DOMRectList;
  }
  if (typeof textProto.getBoundingClientRect !== "function") {
    textProto.getBoundingClientRect = () => new DOMRect();
  }
}

vi.mock("@/components/task/extensions/shiki-code-block", () => ({
  ShikiCodeBlock: inert("shikiCodeBlockStub"),
  SHIKI_CODEBLOCK_REFRESH_META: "shiki-codeblock-refresh",
}));
vi.mock("@/components/task/extensions/mermaid-block", () => ({
  MermaidBlock: inert("mermaidBlockStub"),
}));
vi.mock("@/components/task/extensions/embed-block", () => ({
  EmbedBlock: inert("embedBlockStub"),
}));
vi.mock("@/components/task/extensions/attachment-card", () => ({
  AttachmentCard: inert("attachmentCardStub"),
}));
vi.mock("@/components/task/extensions/kaneo-issue-link", () => ({
  KaneoIssueLink: inert("kaneoIssueLinkStub"),
}));
vi.mock("@/components/task/extensions/task-item-with-checkbox", () => ({
  TaskItemWithCheckbox: TaskItem,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mocks.t }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => ({ data: mocks.config }),
}));
vi.mock("@/lib/upload-page-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-page-image")>()),
  uploadPageImage: mocks.uploadPageImage,
}));
vi.mock("@/lib/toast", () => ({
  toast: {
    error: mocks.toastError,
    info: mocks.toastInfo,
    loading: mocks.toastLoading,
    dismiss: mocks.toastDismiss,
  },
}));
vi.mock("@/lib/shiki-highlighter", () => ({
  getSharedShikiHighlighter: () => new Promise(() => {}),
}));
// Resolve the highlighter hook immediately: DocsEditor dispatches a
// shiki-refresh transaction once a highlighter exists, and that dispatch is
// what drives the Yjs sync plugin's first render in jsdom (in a real browser
// any dispatch — focus, typing, awareness — does the same).
vi.mock("@/components/editor/use-editor-highlighter", () => ({
  useEditorHighlighter: () => ({
    highlighter: {},
    highlighterRef: { current: {} },
    languages: new Set(["text"]),
  }),
}));

function makePage(overrides: Partial<DocsPage> = {}): DocsPage {
  return {
    id: "page-1",
    title: "Untitled",
    ...overrides,
  } as DocsPage;
}

async function renderEditor(canEdit: boolean) {
  const ydoc = new Y.Doc();
  const view = render(
    <DocsEditor
      page={makePage()}
      canEdit={canEdit}
      ydoc={ydoc}
      onRenameTitle={() => {}}
    />,
  );
  await waitFor(() =>
    expect(view.container.querySelector(".ProseMirror")).not.toBeNull(),
  );
  // Tiptap seeds an empty paragraph for a fresh collaborative document, so
  // the body always has a selectable text block even for brand-new pages.
  await waitFor(() =>
    expect(view.container.querySelector(".ProseMirror p")).not.toBeNull(),
  );
  const proseMirror = view.container.querySelector<HTMLElement>(".ProseMirror");
  if (!proseMirror) throw new Error("ProseMirror missing");
  return { ...view, ydoc, proseMirror };
}

describe("DocsEditor", () => {
  beforeEach(() => {
    mocks.config = { hasImageUploads: true };
    mocks.uploadPageImage.mockReset().mockResolvedValue({
      url: "/api/asset/asset-9",
      alt: "paste",
      filename: "paste.png",
      kind: "image",
      mimeType: "image/png",
      size: 18,
    });
    mocks.toastLoading.mockReset().mockReturnValue("toast-id");
    mocks.toastDismiss.mockReset();
    mocks.toastError.mockReset();
    mocks.toastInfo.mockReset();
  });

  function pasteImageFile(proseMirror: HTMLElement) {
    const file = new File(["fake-image-bytes"], "paste.png", {
      type: "image/png",
    });
    fireEvent.paste(proseMirror, {
      clipboardData: { files: [file], getData: () => "" },
    });
  }

  // jsdom cannot synthesize real typing (no beforeinput/editing support), so
  // mutate the observed DOM the way the collaboration test does: ProseMirror's
  // DOMObserver turns it into a transaction (which the Yjs binding syncs) and
  // reconciles the state selection from the DOM selection, which is what
  // drives the slash menu through update/selectionUpdate listeners.
  function typeText(proseMirror: HTMLElement, text: string) {
    proseMirror.focus();
    const paragraph = proseMirror.querySelector("p");
    if (!paragraph) throw new Error("paragraph missing");
    const node = document.createTextNode(text);
    paragraph.appendChild(node);
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(node, text.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  async function typeTextAndSync(proseMirror: HTMLElement, text: string) {
    typeText(proseMirror, text);
    await waitFor(() => expect(proseMirror.textContent).toContain(text));
  }

  function slashMenu(container: HTMLElement) {
    return container.querySelector(".kaneo-tiptap-slash-menu");
  }

  function slashItemLabels(container: HTMLElement) {
    return Array.from(
      container.querySelectorAll(".kaneo-tiptap-slash-item"),
    ).map((item) => item.textContent ?? "");
  }
  it("renders an editable body with the shared prose styles and an initial paragraph", async () => {
    const { container, proseMirror, unmount } = await renderEditor(true);
    try {
      // Editable for owners/editors.
      expect(proseMirror.getAttribute("contenteditable")).toBe("true");
      // Styling hook: without kaneo-tiptap-content none of the ProseMirror
      // base rules (min-height, padding, placeholder) apply and the empty
      // body collapses to an unclickable strip.
      const styled = container.querySelector(
        ".kaneo-tiptap-content.docs-body-editor .ProseMirror",
      );
      expect(styled).not.toBeNull();
      // The Yjs binding seeds an initial paragraph, so the body always has a
      // selectable text block even for brand-new pages.
      expect(proseMirror.querySelector("p")).not.toBeNull();
      // Title stays editable.
      const title = container.querySelector("input");
      expect(title?.getAttribute("readonly")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("is read-only for viewers without edit permission", async () => {
    const { container, proseMirror, unmount } = await renderEditor(false);
    try {
      expect(proseMirror.getAttribute("contenteditable")).toBe("false");
      const title = container.querySelector("input");
      expect(title?.getAttribute("readonly")).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("propagates local edits into the shared Y.Doc (collaboration is live)", async () => {
    const { proseMirror, ydoc, unmount } = await renderEditor(true);
    try {
      // Simulate typing the way a browser does: mutate the observed DOM and
      // let ProseMirror's DOMObserver turn it into a transaction, which the
      // Yjs binding then propagates to every peer.
      (proseMirror as HTMLElement).focus();
      const paragraph = proseMirror.querySelector("p");
      expect(paragraph).not.toBeNull();
      paragraph?.appendChild(document.createTextNode("hello docs"));
      await waitFor(() =>
        expect(Y.encodeStateAsUpdate(ydoc).length).toBeGreaterThan(0),
      );
      expect(ydoc.getXmlFragment("default").toString()).toContain("hello docs");
    } finally {
      unmount();
    }
  });

  it("inserts an uploaded image node when an image file is pasted", async () => {
    const { proseMirror, unmount } = await renderEditor(true);
    try {
      pasteImageFile(proseMirror);

      await waitFor(() =>
        expect(mocks.uploadPageImage).toHaveBeenCalledTimes(1),
      );
      expect(mocks.uploadPageImage).toHaveBeenCalledWith(
        expect.objectContaining({ pageId: "page-1" }),
      );
      await waitFor(() =>
        expect(proseMirror.querySelector("img")).not.toBeNull(),
      );
      expect(proseMirror.querySelector("img")?.getAttribute("src")).toBe(
        "/api/asset/asset-9",
      );
    } finally {
      unmount();
    }
  });

  it("ignores pasted images with an informational toast when uploads are not configured", async () => {
    mocks.config = { hasImageUploads: false };
    const { proseMirror, unmount } = await renderEditor(true);
    try {
      pasteImageFile(proseMirror);

      await waitFor(() =>
        expect(mocks.toastInfo).toHaveBeenCalledWith("docs:image.unavailable"),
      );
      expect(mocks.uploadPageImage).not.toHaveBeenCalled();
      expect(proseMirror.querySelector("img")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("does not upload pasted images for read-only viewers", async () => {
    const { proseMirror, unmount } = await renderEditor(false);
    try {
      pasteImageFile(proseMirror);

      // Give any (incorrect) async upload path a chance to run.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mocks.uploadPageImage).not.toHaveBeenCalled();
      expect(proseMirror.querySelector("img")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("opens the slash menu on '/' and filters as you type", async () => {
    const { container, proseMirror, unmount } = await renderEditor(true);
    try {
      await typeTextAndSync(proseMirror, "/");

      await waitFor(() => expect(slashMenu(container)).not.toBeNull());
      const menu = slashMenu(container)!;
      expect(menu.getAttribute("role")).toBe("listbox");
      const labels = slashItemLabels(container);
      // All rich-text block commands plus the docs Image command.
      expect(labels.some((label) => label.includes("slashHeading"))).toBe(true);
      expect(labels.some((label) => label.includes("docs:slash.image"))).toBe(
        true,
      );
      expect(
        container.querySelectorAll('.kaneo-tiptap-slash-item[role="option"]')
          .length,
      ).toBeGreaterThan(0);

      await typeTextAndSync(proseMirror, "head");

      await waitFor(() =>
        expect(
          slashItemLabels(container).every((label) =>
            label.toLowerCase().includes("head"),
          ),
        ).toBe(true),
      );
      expect(slashItemLabels(container).length).toBe(1);
    } finally {
      unmount();
    }
  });

  it("runs the selected slash command on Enter and removes the '/text'", async () => {
    const { container, proseMirror, unmount } = await renderEditor(true);
    try {
      await typeTextAndSync(proseMirror, "/head");

      await waitFor(() => expect(slashMenu(container)).not.toBeNull());
      fireEvent.keyDown(proseMirror, { key: "Enter" });

      await waitFor(() =>
        expect(proseMirror.querySelector("h2")).not.toBeNull(),
      );
      expect(proseMirror.textContent).not.toContain("/head");
      expect(slashMenu(container)).toBeNull();
    } finally {
      unmount();
    }
  });

  it("closes the slash menu on Escape", async () => {
    const { container, proseMirror, unmount } = await renderEditor(true);
    try {
      await typeTextAndSync(proseMirror, "/");

      await waitFor(() => expect(slashMenu(container)).not.toBeNull());
      fireEvent.keyDown(proseMirror, { key: "Escape" });

      await waitFor(() => expect(slashMenu(container)).toBeNull());
    } finally {
      unmount();
    }
  });

  it("shows no slash menu for read-only viewers", async () => {
    const { container, proseMirror, unmount } = await renderEditor(false);
    try {
      typeText(proseMirror, "/");

      // Give any (incorrect) menu path a chance to render.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(slashMenu(container)).toBeNull();
      expect(container.querySelector('input[type="file"]')).toBeNull();
    } finally {
      unmount();
    }
  });

  it("uploads and inserts an image through the slash Image command", async () => {
    const { container, proseMirror, unmount } = await renderEditor(true);
    try {
      await typeTextAndSync(proseMirror, "/");

      await waitFor(() => expect(slashMenu(container)).not.toBeNull());
      const imageItem = Array.from(
        container.querySelectorAll(".kaneo-tiptap-slash-item"),
      ).find((item) => item.textContent?.includes("docs:slash.image"));
      expect(imageItem).not.toBeUndefined();
      fireEvent.mouseDown(imageItem!);

      // Choosing Image clears the "/" trigger and opens the file picker.
      expect(proseMirror.textContent).not.toContain("/");
      const fileInput =
        container.querySelector<HTMLInputElement>('input[type="file"]');
      expect(fileInput).not.toBeNull();

      const file = new File(["fake-image-bytes"], "slash.png", {
        type: "image/png",
      });
      fireEvent.change(fileInput!, { target: { files: [file] } });

      await waitFor(() =>
        expect(mocks.uploadPageImage).toHaveBeenCalledTimes(1),
      );
      expect(mocks.uploadPageImage).toHaveBeenCalledWith(
        expect.objectContaining({ pageId: "page-1" }),
      );
      await waitFor(() =>
        expect(proseMirror.querySelector("img")).not.toBeNull(),
      );
      expect(proseMirror.querySelector("img")?.getAttribute("src")).toBe(
        "/api/asset/asset-9",
      );
    } finally {
      unmount();
    }
  });

  function tablePickerDialog(container: HTMLElement) {
    return container.querySelector(".kaneo-table-size-picker");
  }

  function tableSize(proseMirror: HTMLElement) {
    const table = proseMirror.querySelector("table");
    if (!table) return null;
    const rows = table.querySelectorAll("tr");
    if (rows.length === 0) return null;
    return {
      rows: rows.length,
      cols: rows[0]?.querySelectorAll("th, td").length ?? 0,
    };
  }

  function toolbarButton(container: HTMLElement, key: string) {
    return container.querySelector(`button[aria-label="${key}"]`);
  }

  async function openTablePicker(
    container: HTMLElement,
    proseMirror: HTMLElement,
  ) {
    await typeTextAndSync(proseMirror, "/table");

    await waitFor(() => expect(slashMenu(container)).not.toBeNull());
    const items = container.querySelectorAll(".kaneo-tiptap-slash-item");
    expect(items.length).toBe(1);
    fireEvent.mouseDown(items[0]!);

    // Choosing Table clears the "/" trigger and opens the size picker.
    await waitFor(() => expect(tablePickerDialog(container)).not.toBeNull());
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(proseMirror.textContent).not.toContain("/");
  }

  it("opens the table size picker from the slash Table command and removes the '/' trigger", async () => {
    const { container, proseMirror, unmount } = await renderEditor(true);
    try {
      await openTablePicker(container, proseMirror);
      expect(tablePickerDialog(container)?.getAttribute("aria-label")).toBe(
        "docs:table.pickerLabel",
      );
    } finally {
      unmount();
    }
  });

  it("inserts the chosen table size and manages rows/columns through the table toolbar", async () => {
    const { container, proseMirror, unmount } = await renderEditor(true);
    try {
      await openTablePicker(container, proseMirror);

      const pickerCell = container.querySelector(
        'button[data-row="2"][data-col="4"]',
      );
      expect(pickerCell).not.toBeNull();
      fireEvent.click(pickerCell!);

      await waitFor(() =>
        expect(proseMirror.querySelector("table")).not.toBeNull(),
      );
      expect(tableSize(proseMirror)).toEqual({ rows: 2, cols: 4 });
      // Header row: the first row uses th cells.
      expect(
        proseMirror.querySelectorAll("table tr:first-child th").length,
      ).toBe(4);
      expect(tablePickerDialog(container)).toBeNull();

      // The toolbar appears because the cursor lands inside the new table.
      const addRowAfter = toolbarButton(container, "docs:table.addRowAfter");
      expect(addRowAfter).not.toBeNull();
      fireEvent.click(addRowAfter!);
      await waitFor(() =>
        expect(tableSize(proseMirror)).toEqual({ rows: 3, cols: 4 }),
      );

      const addColumnAfter = toolbarButton(
        container,
        "docs:table.addColumnAfter",
      );
      expect(addColumnAfter).not.toBeNull();
      fireEvent.click(addColumnAfter!);
      await waitFor(() =>
        expect(tableSize(proseMirror)).toEqual({ rows: 3, cols: 5 }),
      );

      const deleteRow = toolbarButton(container, "docs:table.deleteRow");
      expect(deleteRow).not.toBeNull();
      fireEvent.click(deleteRow!);
      await waitFor(() =>
        expect(tableSize(proseMirror)).toEqual({ rows: 2, cols: 5 }),
      );
    } finally {
      unmount();
    }
  });

  it("shows no table tools for read-only viewers even when the page has a table", async () => {
    const first = await renderEditor(true);
    try {
      await openTablePicker(first.container, first.proseMirror);
      const pickerCell = first.container.querySelector(
        'button[data-row="2"][data-col="2"]',
      );
      expect(pickerCell).not.toBeNull();
      fireEvent.click(pickerCell!);
      await waitFor(() =>
        expect(first.proseMirror.querySelector("table")).not.toBeNull(),
      );
    } finally {
      first.unmount();
    }

    const second = render(
      <DocsEditor
        page={makePage()}
        canEdit={false}
        ydoc={first.ydoc}
        onRenameTitle={() => {}}
      />,
    );
    try {
      await waitFor(() =>
        expect(
          second.container.querySelector(".ProseMirror table"),
        ).not.toBeNull(),
      );
      expect(
        toolbarButton(second.container, "docs:table.addRowAfter"),
      ).toBeNull();
      expect(
        toolbarButton(second.container, "docs:table.deleteTable"),
      ).toBeNull();
      expect(tablePickerDialog(second.container)).toBeNull();
    } finally {
      second.unmount();
    }
  });

  it("keeps a tall click target for the docs body in the stylesheet", () => {
    // src/components/docs -> src is two levels up.
    const cssPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "index.css",
    );
    const css = readFileSync(cssPath, "utf8");
    expect(css).toContain(".docs-body-editor .ProseMirror");
    expect(css).toMatch(
      /\.docs-body-editor \.ProseMirror\s*\{[^}]*min-height:\s*40vh/,
    );
  });

  it("keeps a visible docs table grid in the stylesheet", () => {
    // The shared prose grid (--border at ~8%) is too faint to read; the
    // docs-scoped rules must exist so task/comment tables stay untouched.
    const cssPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "index.css",
    );
    const css = readFileSync(cssPath, "utf8");
    // Collapsed 1px grid on every docs cell.
    expect(css).toMatch(
      /\.docs-body-editor \.ProseMirror table[\s\S]*?border-collapse:\s*collapse/,
    );
    expect(css).toMatch(
      /\.docs-body-editor \.ProseMirror table td[\s\S]*?border:\s*1px solid/,
    );
    // Outer edge owned by the wrapper (rounded corners) with edge cells
    // shedding their outer side so the outline stays a single pixel.
    expect(css).toMatch(
      /\.docs-body-editor \.ProseMirror \.tableWrapper\s*\{[^}]*border:\s*1px solid/,
    );
    expect(css).toMatch(
      /\.docs-body-editor \.ProseMirror \.tableWrapper\s*\{[^}]*border-radius:/,
    );
    expect(css).toContain("tr:last-child");
    // Muted header row.
    expect(css).toMatch(
      /\.docs-body-editor \.ProseMirror table th\s*\{[^}]*background:\s*var\(--muted\)/,
    );
    // Range-selection tint still paints above the new borders.
    expect(css).toMatch(
      /\.docs-body-editor \.ProseMirror \.selectedCell:after\s*\{[^}]*background:/,
    );
  });

  it("renders a large title with the meta line directly below it", async () => {
    const ydoc = new Y.Doc();
    const view = render(
      <DocsEditor
        page={makePage({
          title: "Big title",
          updatedAt: "2026-10-16T14:28:00.000Z",
          updatedBy: { id: "user-1", name: "Ada" },
        })}
        canEdit={true}
        ydoc={ydoc}
        onRenameTitle={() => {}}
      />,
    );
    try {
      await waitFor(() =>
        expect(view.container.querySelector(".ProseMirror")).not.toBeNull(),
      );
      const title = view.container.querySelector(
        'input[aria-label="docs:tree.rename"]',
      );
      expect(title).not.toBeNull();
      if (!title) throw new Error("title input missing");
      // The shared Input put its text sizing on a wrapper span, which shrank
      // the title; the header now uses a plain input with large type.
      expect(title.className).toContain("text-4xl");
      expect(title.className).toContain("font-bold");
      // Meta line sits directly below the title, before the body editor.
      const meta = title.nextElementSibling;
      expect(meta?.textContent).toContain("docs:meta.edited");
      const body = view.container.querySelector(".kaneo-tiptap-shell");
      if (!meta || !body) throw new Error("meta line or body missing");
      expect(
        title.compareDocumentPosition(meta) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        meta.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    } finally {
      view.unmount();
    }
  });

  it("hides the meta line until the API provides editor or date", async () => {
    const ydoc = new Y.Doc();
    const view = render(
      <DocsEditor
        page={makePage({ updatedBy: null })}
        canEdit={true}
        ydoc={ydoc}
        onRenameTitle={() => {}}
      />,
    );
    try {
      await waitFor(() =>
        expect(view.container.querySelector(".ProseMirror")).not.toBeNull(),
      );
      // makePage has no updatedAt, and updatedBy is null, so no meta line.
      expect(view.container.textContent).not.toContain("docs:meta.edited");
      expect(view.container.textContent).not.toContain(
        "docs:meta.editedNoName",
      );
    } finally {
      view.unmount();
    }
  });
});
