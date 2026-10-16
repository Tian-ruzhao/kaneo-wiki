import { Collaboration } from "@tiptap/extension-collaboration";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import { TextStyle } from "@tiptap/extension-text-style";
import type { Editor } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  Bold,
  Braces,
  Code,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Strikethrough,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type * as Y from "yjs";
import { BubbleLinkEditor } from "@/components/editor/bubble-link-editor";
import { createEditorExtensions } from "@/components/editor/extensions";
import { insertUploadedAsset } from "@/components/editor/insert-uploaded-asset";
import { selectionStartAnchor } from "@/components/editor/selection-start-anchor";
import {
  richTextCommands,
  type SlashCommand,
  type SlashRange,
} from "@/components/editor/slash-commands";
import {
  filterSlashCommands,
  matchSlashTrigger,
  SlashMenu,
  type SlashMenuState,
} from "@/components/editor/slash-menu";
import { useEditorHighlighter } from "@/components/editor/use-editor-highlighter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SHIKI_CODEBLOCK_REFRESH_META } from "@/components/task/extensions/shiki-code-block";
import { DocsImage } from "./extensions/docs-image";
import { DocsTableToolbar } from "./docs-table-toolbar";
import { DocsTextColorPicker } from "./docs-text-color-picker";
import {
  clearCellSelection,
  shouldShowDocsTableToolbar,
} from "./docs-table-selection";
import { TableSizePicker } from "./table-size-picker";
import type { DocsPage } from "@/hooks/queries/page/use-get-pages";
import useGetConfig from "@/hooks/queries/config/use-get-config";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";
import {
  isSupportedPageImageFile,
  uploadPageImage,
} from "@/lib/upload-page-image";

type DocsEditorProps = {
  page: DocsPage;
  canEdit: boolean;
  ydoc: Y.Doc;
  onRenameTitle: (title: string) => void;
};

/**
 * The floating text toolbar shows for a non-empty text selection only. A
 * cell range gets the table toolbar instead, never both.
 */
export function shouldShowDocsTextBubble(
  activeEditor: Editor,
  from: number,
  to: number,
): boolean {
  if (activeEditor.isActive("embedBlock")) return false;
  if (activeEditor.isActive("image")) return false;
  if (activeEditor.isEmpty) return false;
  // A cell range gets the table toolbar, not the text toolbar.
  if (activeEditor.state.selection instanceof CellSelection) {
    return false;
  }
  return from !== to;
}

export function DocsEditor({
  page,
  canEdit,
  ydoc,
  onRenameTitle,
}: DocsEditorProps) {
  const { t } = useTranslation();
  const { highlighter, highlighterRef } = useEditorHighlighter();
  const [title, setTitle] = useState(page.title);
  const [isEditingLink, setIsEditingLink] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const bodyEditorRef = useRef<HTMLDivElement | null>(null);
  const dragDepthRef = useRef(0);
  const editorRef = useRef<Editor | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const pendingImageInsertRef = useRef<{ editor: Editor } | null>(null);
  const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null);
  const [tablePicker, setTablePicker] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const { data: config } = useGetConfig();
  // Unknown (still loading) means available; the API reports 503 with a
  // clear message if storage is actually off.
  const uploadsAvailable = config?.hasImageUploads !== false;

  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const pageIdRef = useRef(page.id);
  pageIdRef.current = page.id;
  const uploadsAvailableRef = useRef(uploadsAvailable);
  uploadsAvailableRef.current = uploadsAvailable;

  const handlePageImageUpload = useCallback(
    async (
      files: File[],
      targetEditor: Editor | null,
      range?: { from: number; to: number },
    ) => {
      if (!canEditRef.current) return;
      const activeEditor = targetEditor ?? editorRef.current;
      if (!activeEditor || activeEditor.isDestroyed) {
        toast.error(t("docs:image.uploadFailed"));
        return;
      }

      const pageId = pageIdRef.current;
      const loadingToast = toast.loading(t("docs:image.uploading"));

      try {
        for (const [index, file] of files.entries()) {
          const asset = await uploadPageImage({ pageId, file });
          // The editor can be destroyed and replaced while the upload is in
          // flight; fall back to the current instance for the same page.
          const currentEditor = !activeEditor.isDestroyed
            ? activeEditor
            : editorRef.current;
          if (
            !currentEditor ||
            currentEditor.isDestroyed ||
            pageIdRef.current !== pageId
          ) {
            throw new Error(t("docs:image.uploadFailed"));
          }
          // Images go through the editor command chain so Yjs syncs them to
          // every collaborator; insertUploadedAsset throws on failure.
          insertUploadedAsset(
            currentEditor,
            asset,
            t("docs:image.uploadFailed"),
            index === 0 ? range : undefined,
          );
        }
        toast.dismiss(loadingToast);
      } catch (error) {
        toast.dismiss(loadingToast);
        toast.error(
          error instanceof Error ? error.message : t("docs:image.uploadFailed"),
        );
      }
    },
    [t],
  );

  // Remote renames flow in unless the title field is being edited.
  useEffect(() => {
    if (!editingTitle) setTitle(page.title);
  }, [page.id, page.title, editingTitle]);

  const hasFileDrag = useCallback((event: React.DragEvent<HTMLElement>) => {
    return Array.from(event.dataTransfer?.items || []).some(
      (item) => item.kind === "file",
    );
  }, []);

  const handleShellDragEnter = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (!canEditRef.current || !hasFileDrag(event)) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setIsDragActive(true);
    },
    [hasFileDrag],
  );

  const handleShellDragOver = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (!canEditRef.current || !hasFileDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      if (!isDragActive) {
        setIsDragActive(true);
      }
    },
    [hasFileDrag, isDragActive],
  );

  const handleShellDragLeave = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (!canEditRef.current || !hasFileDrag(event)) return;
      event.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsDragActive(false);
      }
    },
    [hasFileDrag],
  );

  const handleShellDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (!canEditRef.current || !hasFileDrag(event)) return;
      dragDepthRef.current = 0;
      setIsDragActive(false);
    },
    [hasFileDrag],
  );

  const openImagePicker = useCallback((activeEditor?: Editor | null) => {
    pendingImageInsertRef.current = activeEditor
      ? { editor: activeEditor }
      : null;
    imageInputRef.current?.click();
  }, []);

  // All block commands run through editor.chain() so Yjs syncs them to every
  // collaborator. Labels reuse the comment editor's slash keys; only the
  // docs-only Image command gets docs:slash.* keys.
  const slashCommands = useMemo<SlashCommand[]>(
    () => [
      ...(
        [
          "paragraph",
          "heading-2",
          "bullet-list",
          "task-list",
          "ordered-list",
          "blockquote",
          "code-block",
          "table",
        ] as const
      ).map((id) => {
        const base = richTextCommands.find((command) => command.id === id)!;
        const keyById: Record<string, string> = {
          paragraph: "slashParagraph",
          "heading-2": "slashHeading",
          "bullet-list": "slashBulletList",
          "task-list": "slashTaskList",
          "ordered-list": "slashOrderedList",
          blockquote: "slashQuote",
          "code-block": "slashCodeBlock",
          table: "slashTable",
        };
        const searchKeyById: Record<string, string> = {
          paragraph: "searchParagraph",
          "heading-2": "searchHeading",
          "bullet-list": "searchBulletList",
          "task-list": "searchTaskList",
          "ordered-list": "searchOrderedList",
          blockquote: "searchQuote",
          "code-block": "searchCodeBlock",
          table: "searchTable",
        };
        return {
          ...base,
          label: t(`activity:comment.editor.${keyById[id]}`),
          search: t(`activity:comment.editor.${searchKeyById[id]}`),
        };
      }),
      {
        id: "image",
        label: t("docs:slash.image"),
        group: "insert",
        search: t("docs:slash.searchImage"),
        run: (activeEditor, range) => {
          if (!uploadsAvailableRef.current) {
            activeEditor.chain().focus().deleteRange(range).run();
            toast.info(t("docs:image.unavailable"));
            return;
          }
          activeEditor.chain().focus().deleteRange(range).run();
          openImagePicker(activeEditor);
        },
      },
    ],
    [openImagePicker, t],
  );

  const filteredSlashCommands = useMemo(
    () => filterSlashCommands(slashCommands, slashMenu?.query ?? ""),
    [slashCommands, slashMenu?.query],
  );

  const groupedSlashCommands = useMemo(
    () => [
      {
        title: t("activity:comment.editor.slashGroupText"),
        items: filteredSlashCommands.filter(
          (command) => command.group === "text",
        ),
      },
      {
        title: t("activity:comment.editor.slashGroupLists"),
        items: filteredSlashCommands.filter(
          (command) => command.group === "lists",
        ),
      },
      {
        title: t("activity:comment.editor.slashGroupInsert"),
        items: filteredSlashCommands.filter(
          (command) => command.group === "insert",
        ),
      },
    ],
    [filteredSlashCommands, t],
  );

  const slashMenuRef = useRef(slashMenu);
  slashMenuRef.current = slashMenu;
  const filteredSlashCommandsRef = useRef(filteredSlashCommands);
  filteredSlashCommandsRef.current = filteredSlashCommands;

  const getSlashMenuPosition = useCallback(
    (editorView: Editor["view"], pos: number) => {
      // coordsAtPos needs layout geometry; fall back to the shell origin
      // when it is unavailable (e.g. headless test environments).
      let coords = { top: 0, bottom: 0, left: 0 };
      try {
        coords = editorView.coordsAtPos(pos);
      } catch {
        // keep the fallback
      }
      const shellRect = bodyEditorRef.current?.getBoundingClientRect();
      if (!shellRect) {
        return { top: coords.bottom + 8, left: coords.left };
      }
      return {
        top: coords.bottom - shellRect.top + 8,
        left: coords.left - shellRect.left,
      };
    },
    [],
  );

  const updateSlashMenu = useCallback(
    (activeEditor: Editor) => {
      if (!canEditRef.current) {
        setSlashMenu(null);
        return;
      }

      const { state, view } = activeEditor;
      if (!state.selection.empty) {
        setSlashMenu(null);
        return;
      }

      const { $from } = state.selection;
      if (!$from.parent.isTextblock) {
        setSlashMenu(null);
        return;
      }

      const textBefore = $from.parent.textBetween(
        0,
        $from.parentOffset,
        "\0",
        "\0",
      );
      const trigger = matchSlashTrigger(textBefore);
      if (!trigger) {
        setSlashMenu(null);
        return;
      }

      const { query, matchText } = trigger;
      const startsWithSpace = matchText.startsWith(" ");
      const slashOffset =
        $from.parentOffset - matchText.length + (startsWithSpace ? 1 : 0);
      const from = $from.start() + slashOffset;
      const to = from + matchText.trimStart().length;
      const { top, left } = getSlashMenuPosition(view, $from.pos);

      setSlashMenu((current) => ({
        from,
        to,
        query,
        top,
        left,
        selectedIndex: current?.query === query ? current.selectedIndex : 0,
      }));
    },
    [getSlashMenuPosition],
  );

  const tablePickerRef = useRef(tablePicker);
  tablePickerRef.current = tablePicker;

  const closeTablePicker = useCallback(() => {
    setTablePicker(null);
    editorRef.current?.commands.focus();
  }, []);

  const insertTableSize = useCallback((rows: number, cols: number) => {
    const activeEditor = editorRef.current;
    if (!activeEditor || activeEditor.isDestroyed) return;
    // A normal transaction, so Yjs syncs the table to every collaborator.
    activeEditor
      .chain()
      .focus()
      .insertTable({ rows, cols, withHeaderRow: true })
      .run();
    setTablePicker(null);
  }, []);

  const runSlashCommand = useCallback(
    (command: SlashCommand, range: SlashRange) => {
      const activeEditor = editorRef.current;
      if (!activeEditor || activeEditor.isDestroyed) return;
      if (command.id === "table") {
        // The shared 3x3 default stays for other editors; docs opens the
        // size picker instead. Remove the "/" trigger first, then show the
        // picker where the caret is.
        activeEditor.chain().focus().deleteRange(range).run();
        const position = getSlashMenuPosition(
          activeEditor.view,
          activeEditor.state.selection.from,
        );
        setTablePicker(position);
        setSlashMenu(null);
        return;
      }
      command.run(activeEditor, range);
      setSlashMenu(null);
    },
    [getSlashMenuPosition],
  );

  const editor = useEditor(
    {
      immediatelyRender: false,
      // Creation-time value; updates flow through the setEditable effect
      // below so toggling canEdit never recreates the Yjs binding.
      editable: canEdit,
      extensions: createEditorExtensions({
        placeholder: t("docs:editor.bodyPlaceholder"),
        highlighter: () => highlighterRef.current,
        resolveLanguage: (language) => language,
        image: DocsImage,
        collaborative: true,
        extra: [
          Collaboration.configure({ document: ydoc }),
          // Docs-only marks: font colour (Color needs TextStyle) and
          // multicolour backgrounds. Task and comment editors stay unchanged.
          TextStyle,
          Color,
          Highlight.configure({ multicolor: true }),
        ],
      }),
      editorProps: {
        attributes: {
          class: "kaneo-tiptap-prose",
        },
        handlePaste: (_view, event) => {
          const imageFiles = Array.from(
            event.clipboardData?.files || [],
          ).filter(isSupportedPageImageFile);
          if (imageFiles.length === 0) return false;

          event.preventDefault();
          if (!canEditRef.current) return true;
          if (!uploadsAvailableRef.current) {
            toast.info(t("docs:image.unavailable"));
            return true;
          }
          void handlePageImageUpload(imageFiles, editor);
          return true;
        },
        handleDrop: (view, event) => {
          const imageFiles = Array.from(event.dataTransfer?.files || []).filter(
            isSupportedPageImageFile,
          );
          if (imageFiles.length === 0) return false;

          event.preventDefault();
          if (!canEditRef.current) return true;
          if (!uploadsAvailableRef.current) {
            toast.info(t("docs:image.unavailable"));
            return true;
          }
          const coordinates = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
          const dropRange = coordinates
            ? { from: coordinates.pos, to: coordinates.pos }
            : undefined;
          void handlePageImageUpload(imageFiles, editor, dropRange);
          return true;
        },
        handleKeyDown: (_view, event) => {
          if (!canEditRef.current) return false;
          if (tablePickerRef.current) {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setTablePicker(null);
              editorRef.current?.commands.focus();
              return true;
            }
            // Typing back in the editor dismisses the stale picker.
            setTablePicker(null);
            return false;
          }
          // Escape collapses a cell range back to a text cursor so the
          // table toolbar hides without touching the table itself.
          if (event.key === "Escape") {
            const keyEditor = editorRef.current;
            if (
              keyEditor &&
              !keyEditor.isDestroyed &&
              clearCellSelection(keyEditor)
            ) {
              event.preventDefault();
              event.stopPropagation();
              return true;
            }
          }
          const menu = slashMenuRef.current;
          if (!menu) return false;
          const filtered = filteredSlashCommandsRef.current;

          if (event.key === "ArrowDown") {
            event.preventDefault();
            setSlashMenu((current) => {
              if (!current) return current;
              return {
                ...current,
                selectedIndex:
                  (current.selectedIndex + 1) % Math.max(filtered.length, 1),
              };
            });
            return true;
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            setSlashMenu((current) => {
              if (!current) return current;
              return {
                ...current,
                selectedIndex:
                  (current.selectedIndex - 1 + Math.max(filtered.length, 1)) %
                  Math.max(filtered.length, 1),
              };
            });
            return true;
          }

          if (
            (event.key === "Enter" || event.key === "Tab") &&
            filtered.length
          ) {
            event.preventDefault();
            const command =
              filtered[Math.min(menu.selectedIndex, filtered.length - 1)];
            if (command) {
              runSlashCommand(command, { from: menu.from, to: menu.to });
            }
            return true;
          }

          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setSlashMenu(null);
            return true;
          }

          return false;
        },
      },
    },
    [ydoc, handlePageImageUpload],
  );

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const syncSlash = () => updateSlashMenu(editor);
    editor.on("selectionUpdate", syncSlash);
    editor.on("update", syncSlash);

    return () => {
      editor.off("selectionUpdate", syncSlash);
      editor.off("update", syncSlash);
    };
  }, [editor, updateSlashMenu]);

  useEffect(() => {
    if (editor) editor.setEditable(canEdit);
  }, [editor, canEdit]);

  useEffect(() => {
    if (!editor || !highlighter) return;
    editor.view.dispatch(
      editor.state.tr.setMeta(SHIKI_CODEBLOCK_REFRESH_META, true),
    );
  }, [editor, highlighter]);

  const commitTitle = () => {
    setEditingTitle(false);
    const next = title.trim();
    if (next && next !== page.title) {
      onRenameTitle(next);
    } else {
      setTitle(page.title);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 py-8 sm:px-8">
      <Input
        value={title}
        readOnly={!canEdit}
        aria-label={t("docs:tree.rename")}
        placeholder={t("docs:editor.untitled")}
        onChange={(event) => setTitle(event.target.value)}
        onFocus={() => setEditingTitle(true)}
        onBlur={commitTitle}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitTitle();
            editor?.commands.focus();
          } else if (event.key === "Escape") {
            setTitle(page.title);
            setEditingTitle(false);
            (event.target as HTMLInputElement).blur();
          }
        }}
        className="h-auto border-0 bg-transparent px-0 font-semibold text-3xl shadow-none focus-visible:ring-0"
      />
      <div
        ref={bodyEditorRef}
        className={cn(
          "kaneo-tiptap-shell mt-2",
          isDragActive && "is-drag-active",
        )}
        onDragEnter={handleShellDragEnter}
        onDragOver={handleShellDragOver}
        onDragLeave={handleShellDragLeave}
        onDrop={handleShellDrop}
      >
        {canEdit && (
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;

              const pendingInsert = pendingImageInsertRef.current;
              pendingImageInsertRef.current = null;
              void handlePageImageUpload(
                [file],
                pendingInsert?.editor ?? editorRef.current,
              );

              event.target.value = "";
            }}
          />
        )}
        <EditorContent
          editor={editor}
          className="kaneo-tiptap-content docs-body-editor"
        />
        {slashMenu && canEdit && (
          <SlashMenu
            groups={groupedSlashCommands}
            flatCommands={filteredSlashCommands}
            selectedIndex={slashMenu.selectedIndex}
            top={slashMenu.top}
            left={slashMenu.left}
            emptyLabel={t("activity:comment.editor.noCommands")}
            onHover={(index) =>
              setSlashMenu((current) =>
                current ? { ...current, selectedIndex: index } : current,
              )
            }
            onSelect={(command) =>
              runSlashCommand(command, {
                from: slashMenu.from,
                to: slashMenu.to,
              })
            }
          />
        )}
        {tablePicker && canEdit && (
          <TableSizePicker
            top={tablePicker.top}
            left={tablePicker.left}
            label={t("docs:table.pickerLabel", {
              defaultValue: "Insert table",
            })}
            formatSize={(rows, cols) =>
              t("docs:table.size", {
                rows,
                cols,
                defaultValue: `${rows} × ${cols}`,
              })
            }
            onSelect={insertTableSize}
            onClose={closeTablePicker}
          />
        )}
      </div>

      {editor && canEdit && (
        <BubbleMenu
          editor={editor}
          className="kaneo-tiptap-bubble"
          getReferencedVirtualElement={() =>
            editor ? selectionStartAnchor(editor) : null
          }
          options={{ onHide: () => setIsEditingLink(false) }}
          shouldShow={({ editor: activeEditor, from, to }) =>
            shouldShowDocsTextBubble(activeEditor, from, to)
          }
        >
          {isEditingLink ? (
            <BubbleLinkEditor
              editor={editor}
              buttonClassName="kaneo-tiptap-bubble-btn"
              onClose={() => setIsEditingLink(false)}
            />
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className={cn(
                  "kaneo-tiptap-bubble-btn",
                  editor.isActive("heading", { level: 2 }) &&
                    "bg-accent text-accent-foreground",
                )}
                onClick={() =>
                  editor.chain().focus().toggleHeading({ level: 2 }).run()
                }
              >
                <Heading2 className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className={cn(
                  "kaneo-tiptap-bubble-btn",
                  editor.isActive("bulletList") &&
                    "bg-accent text-accent-foreground",
                )}
                onClick={() => editor.chain().focus().toggleBulletList().run()}
              >
                <List className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className={cn(
                  "kaneo-tiptap-bubble-btn",
                  editor.isActive("taskList") &&
                    "bg-accent text-accent-foreground",
                )}
                onClick={() => editor.chain().focus().toggleTaskList().run()}
              >
                <ListTodo className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className={cn(
                  "kaneo-tiptap-bubble-btn",
                  editor.isActive("orderedList") &&
                    "bg-accent text-accent-foreground",
                )}
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
              >
                <ListOrdered className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className={cn(
                  "kaneo-tiptap-bubble-btn",
                  editor.isActive("blockquote") &&
                    "bg-accent text-accent-foreground",
                )}
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
              >
                <Quote className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className={cn(
                  "kaneo-tiptap-bubble-btn",
                  editor.isActive("codeBlock") &&
                    "bg-accent text-accent-foreground",
                )}
                onClick={() => editor.chain().focus().toggleCodeBlock().run()}
              >
                <Braces className="size-3.5" />
              </Button>
              <span className="kaneo-tiptap-bubble-separator" />
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className={cn(
                  "kaneo-tiptap-bubble-btn",
                  editor.isActive("bold") && "bg-accent text-accent-foreground",
                )}
                onClick={() => editor.chain().focus().toggleBold().run()}
              >
                <Bold className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className={cn(
                  "kaneo-tiptap-bubble-btn",
                  editor.isActive("italic") &&
                    "bg-accent text-accent-foreground",
                )}
                onClick={() => editor.chain().focus().toggleItalic().run()}
              >
                <Italic className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className={cn(
                  "kaneo-tiptap-bubble-btn",
                  editor.isActive("strike") &&
                    "bg-accent text-accent-foreground",
                )}
                onClick={() => editor.chain().focus().toggleStrike().run()}
              >
                <Strikethrough className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className={cn(
                  "kaneo-tiptap-bubble-btn",
                  editor.isActive("code") && "bg-accent text-accent-foreground",
                )}
                onClick={() => editor.chain().focus().toggleCode().run()}
              >
                <Code className="size-3.5" />
              </Button>
              <DocsTextColorPicker
                editor={editor}
                buttonClassName="kaneo-tiptap-bubble-btn"
              />
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className={cn(
                  "kaneo-tiptap-bubble-btn",
                  editor.isActive("link") && "bg-accent text-accent-foreground",
                )}
                onClick={() => setIsEditingLink(true)}
              >
                <Link2 className="size-3.5" />
              </Button>
            </>
          )}
        </BubbleMenu>
      )}

      {editor && canEdit && (
        <BubbleMenu
          editor={editor}
          pluginKey="kaneo-docs-table-bubble"
          className="kaneo-tiptap-bubble"
          shouldShow={({ editor: activeEditor }) =>
            shouldShowDocsTableToolbar(activeEditor)
          }
        >
          <DocsTableToolbar
            editor={editor}
            labels={{
              mergeCells: t("docs:table.mergeCells"),
              splitCell: t("docs:table.splitCell"),
              addRowBefore: t("docs:table.addRowBefore"),
              addRowAfter: t("docs:table.addRowAfter"),
              addColumnBefore: t("docs:table.addColumnBefore"),
              addColumnAfter: t("docs:table.addColumnAfter"),
              deleteRow: t("docs:table.deleteRow"),
              deleteColumn: t("docs:table.deleteColumn"),
              deleteTable: t("docs:table.deleteTable"),
              bold: t("docs:table.bold"),
              italic: t("docs:table.italic"),
              underline: t("docs:table.underline"),
              strikethrough: t("docs:table.strikethrough"),
              alignLeft: t("docs:table.alignLeft"),
              alignCenter: t("docs:table.alignCenter"),
              alignRight: t("docs:table.alignRight"),
            }}
          />
        </BubbleMenu>
      )}
    </div>
  );
}

export function DocsEditorLoading() {
  return (
    <div className="mx-auto w-full max-w-[720px] px-4 py-8 sm:px-8">
      <div className="h-9 w-2/3 animate-pulse rounded-md bg-muted" />
      <div className="mt-6 space-y-3">
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
        <div className="h-4 w-11/12 animate-pulse rounded bg-muted" />
        <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}
