import Image from "@tiptap/extension-image";
import type { NodeViewProps } from "@tiptap/react";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditorState,
} from "@tiptap/react";
import { Download, Maximize2, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogPopup } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";

type ImageSource = {
  src: string;
  alt?: string | null;
  title?: string | null;
};

const MIME_EXTENSION_FALLBACKS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/x-icon": "ico",
};

function extensionFromMimeType(mimeType: string | null | undefined) {
  if (!mimeType) return null;
  const subtype = mimeType.split(";")[0]?.trim().toLowerCase();
  if (!subtype || !subtype.startsWith("image/")) return null;
  const known = MIME_EXTENSION_FALLBACKS[subtype];
  if (known) return known;
  const rest = subtype.slice("image/".length);
  return rest === "" ? null : rest;
}

function lastPathSegment(src: string) {
  const withoutQuery = src.split("?")[0]?.split("#")[0] ?? "";
  const raw = withoutQuery.split("/").pop()?.trim() ?? "";
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Pure filename builder, exported for tests. Prefers the author-provided alt
 * text, then the title, then the URL's last path segment, then "image". An
 * extension is derived from the downloaded blob's MIME type when the base
 * name has none.
 */
export function buildImageDownloadFilename(
  source: ImageSource,
  mimeType?: string | null,
) {
  const base =
    source.alt?.trim() ||
    source.title?.trim() ||
    lastPathSegment(source.src) ||
    "image";
  // Never let a hostile alt/title smuggle path separators into the filename.
  const safe = base.replace(/[/\\]/g, "_").trim() || "image";
  if (/\.[a-z0-9]{2,5}$/i.test(safe)) return safe;
  const extension = extensionFromMimeType(mimeType);
  return extension ? `${safe}.${extension}` : safe;
}

export async function downloadNodeImage(
  source: ImageSource,
  options?: { onError?: () => void },
) {
  try {
    const response = await fetch(source.src, { credentials: "include" });
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    const blob = await response.blob();
    const filename = buildImageDownloadFilename(source, blob.type);
    const objectUrl = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      // The anchor must be in the document for the click to trigger a
      // download in Firefox.
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    options?.onError?.();
  }
}

export function DocsImageNodeView({
  editor,
  node,
  selected,
  getPos,
}: NodeViewProps) {
  const { t } = useTranslation();
  const [previewOpen, setPreviewOpen] = useState(false);
  const isEditable = useEditorState({
    editor,
    selector: ({ editor: activeEditor }) => activeEditor.isEditable,
  });

  const src = String(node.attrs.src ?? "");
  const alt = String(node.attrs.alt ?? "");
  const title = node.attrs.title ? String(node.attrs.title) : undefined;

  // Selection itself is ProseMirror default behaviour: the image node is
  // selectable, so mousedown on it produces a NodeSelection, which flips the
  // `selected` prop and reveals the toolbar. No click handler is needed here.
  const handleDelete = () => {
    // A plain transaction so Yjs syncs the deletion to collaborators and the
    // shared undo stack can reverse it.
    editor.chain().focus().deleteSelection().run();
  };

  const handleDownload = () => {
    void downloadNodeImage(
      { src, alt, title },
      { onError: () => toast.error(t("docs:image.downloadFailed")) },
    );
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    // Backspace/Delete on a NodeSelection is ProseMirror default behaviour.
    // Escape explicitly drops the selection; the preview dialog (when open)
    // owns Escape itself and closes natively.
    if (event.key !== "Escape" || previewOpen) return;
    if (typeof getPos !== "function") return;
    try {
      const pos = getPos();
      if (typeof pos !== "number") return;
      event.stopPropagation();
      const after = Math.min(
        pos + node.nodeSize,
        editor.state.doc.content.size,
      );
      editor.chain().focus().setTextSelection(after).run();
    } catch {
      // The node may be gone already; nothing to deselect.
    }
  };

  return (
    <NodeViewWrapper
      as="span"
      className="relative inline-block max-w-full"
      data-selected={selected ? "true" : undefined}
      onKeyDown={handleKeyDown}
    >
      <img
        src={src}
        alt={alt}
        title={title}
        loading="lazy"
        data-selected={selected ? "true" : undefined}
        className={cn(
          "kaneo-editor-image",
          selected &&
            "outline-2 outline-solid outline-primary outline-offset-1",
        )}
      />

      {selected && (
        <span
          role="toolbar"
          aria-label={t("docs:image.toolbar")}
          contentEditable={false}
          className="absolute bottom-full left-0 z-10 mb-2 flex gap-0.5 rounded-lg border bg-popover p-1 shadow-md"
        >
          <button
            type="button"
            aria-label={t("docs:image.enlarge")}
            title={t("docs:image.enlarge")}
            onClick={() => setPreviewOpen(true)}
            className="inline-flex size-7 items-center justify-center rounded-md text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          >
            <Maximize2 className="size-4" />
          </button>
          <button
            type="button"
            aria-label={t("docs:image.download")}
            title={t("docs:image.download")}
            onClick={handleDownload}
            className="inline-flex size-7 items-center justify-center rounded-md text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          >
            <Download className="size-4" />
          </button>
          {isEditable && (
            <button
              type="button"
              aria-label={t("docs:image.delete")}
              title={t("docs:image.delete")}
              onClick={handleDelete}
              className="inline-flex size-7 items-center justify-center rounded-md text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </span>
      )}

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogPopup
          showCloseButton={false}
          bottomStickOnMobile={false}
          className="max-w-6xl border-0 bg-transparent p-0 shadow-none before:hidden"
        >
          <div className="relative flex max-h-[90vh] items-center justify-center p-4">
            <img
              src={src}
              alt={alt}
              className="max-h-[85vh] max-w-[90vw] rounded-xl border border-white/12 bg-black/30 object-contain shadow-2xl"
            />
            <button
              type="button"
              aria-label={t("docs:image.close")}
              title={t("docs:image.close")}
              onClick={() => setPreviewOpen(false)}
              className="absolute end-6 top-6 inline-flex size-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <X className="size-4" />
            </button>
          </div>
        </DialogPopup>
      </Dialog>
    </NodeViewWrapper>
  );
}

/**
 * Docs image: the stock image node with a node view so images are clickable,
 * show a selected state, and expose enlarge / download / delete actions. The
 * node type stays `image`, so documents keep syncing through Yjs untouched.
 */
export const DocsImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(DocsImageNodeView);
  },
});
