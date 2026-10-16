import { ChevronRight, FileText, MoreHorizontal, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import type { DocsPage } from "@/hooks/queries/page/use-get-pages";
import { cn } from "@/lib/cn";
import {
  buildDocsTree,
  clampFocusIndex,
  flattenDocsTree,
  getRelativeFocusIndex,
  type DocsFlatNode,
} from "@/lib/docs-tree";

export type PageMenuAction =
  | { kind: "new-sub-page"; id: string }
  | { kind: "rename"; id: string }
  | { kind: "copy-link"; id: string }
  | { kind: "move"; id: string }
  | { kind: "delete"; id: string };

export function PageMenu({
  pageId,
  canEdit,
  onAction,
  align = "end",
}: {
  pageId: string;
  canEdit: boolean;
  onAction: (action: PageMenuAction) => void;
  align?: "end" | "start";
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 opacity-0 group-hover/menu-row:opacity-100 group-focus-within/menu-row:opacity-100 data-popup-open:opacity-100 focus-visible:opacity-100"
            aria-label={t("docs:tree.more")}
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align={align} sideOffset={4}>
        {canEdit && (
          <DropdownMenuItem
            onClick={() => onAction({ kind: "new-sub-page", id: pageId })}
          >
            {t("docs:tree.newSubPage")}
          </DropdownMenuItem>
        )}
        {canEdit && (
          <DropdownMenuItem
            onClick={() => onAction({ kind: "rename", id: pageId })}
          >
            {t("docs:tree.rename")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() => onAction({ kind: "copy-link", id: pageId })}
        >
          {t("docs:tree.copyLink")}
        </DropdownMenuItem>
        {canEdit && (
          <DropdownMenuItem
            onClick={() => onAction({ kind: "move", id: pageId })}
          >
            {t("docs:tree.move")}
          </DropdownMenuItem>
        )}
        {canEdit && <DropdownMenuSeparator />}
        {canEdit && (
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onAction({ kind: "delete", id: pageId })}
          >
            {t("docs:tree.delete")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type DocsTreePanelProps = {
  pages: DocsPage[];
  selectedId: string | null;
  canEdit: boolean;
  renameSignal: { id: string; nonce: number } | null;
  onSelect: (id: string) => void;
  onCreate: (parentId: string | null) => void;
  onRename: (id: string, title: string) => void;
  onMenuAction: (action: PageMenuAction) => void;
};

export function DocsTreePanel({
  pages,
  selectedId,
  canEdit,
  renameSignal,
  onSelect,
  onCreate,
  onRename,
  onMenuAction,
}: DocsTreePanelProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(pages.map((page) => page.id)),
  );
  const [search, setSearch] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [focusIndex, setFocusIndex] = useState(0);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const knownIds = useRef<Set<string>>(new Set());

  const roots = useMemo(() => buildDocsTree(pages), [pages]);

  // Expand newly seen pages (initial load, creates, collaborator adds) so
  // the tree opens populated; explicit user collapses are never overridden.
  useEffect(() => {
    const fresh = pages
      .map((page) => page.id)
      .filter((id) => !knownIds.current.has(id));
    if (fresh.length === 0) return;
    for (const id of pages.map((page) => page.id)) knownIds.current.add(id);
    setExpanded((current) => new Set([...current, ...fresh]));
  }, [pages]);

  // Keep the selected page visible when the selection moves.
  useEffect(() => {
    if (!selectedId) return;
    const byId = new Map(pages.map((page) => [page.id, page]));
    const ancestors = new Set<string>();
    let current = byId.get(selectedId)?.parentId ?? null;
    while (current !== null && !ancestors.has(current)) {
      ancestors.add(current);
      current = byId.get(current)?.parentId ?? null;
    }
    if (ancestors.size > 0) {
      setExpanded((currentExpanded) => {
        const next = new Set(currentExpanded);
        for (const id of ancestors) next.add(id);
        return next;
      });
    }
  }, [selectedId, pages]);

  useEffect(() => {
    if (renameSignal) {
      const page = pages.find((candidate) => candidate.id === renameSignal.id);
      setRenamingId(renameSignal.id);
      setDraft(page?.title ?? "");
    }
  }, [renameSignal, pages]);

  const query = search.trim().toLowerCase();
  const rows = useMemo(() => {
    if (!query) return flattenDocsTree(roots, expanded);
    // Filtered search shows every match with its real depth.
    const all = flattenDocsTree(roots, new Set(pages.map((page) => page.id)));
    return all.filter((row) => row.page.title.toLowerCase().includes(query));
  }, [roots, expanded, query, pages]);

  useEffect(() => {
    setFocusIndex((current) => clampFocusIndex(current, rows.length));
  }, [rows.length]);

  const focusRow = useCallback((index: number) => {
    const clamped = clampFocusIndex(index, rowRefs.current.length);
    setFocusIndex(clamped);
    rowRefs.current[clamped]?.focus();
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const commitRename = useCallback(
    (id: string) => {
      const page = pages.find((candidate) => candidate.id === id);
      const title = draft.trim();
      setRenamingId(null);
      if (page && title && title !== page.title) {
        onRename(id, title);
      }
    },
    [draft, onRename, pages],
  );

  const handleTreeKeyDown = useCallback(
    (
      event: React.KeyboardEvent,
      row: DocsFlatNode<DocsPage>,
      index: number,
    ) => {
      const { key } = event;
      if (key === "ArrowDown") {
        event.preventDefault();
        focusRow(getRelativeFocusIndex(index, 1, rows.length));
      } else if (key === "ArrowUp") {
        event.preventDefault();
        focusRow(getRelativeFocusIndex(index, -1, rows.length));
      } else if (key === "ArrowRight") {
        if (row.hasChildren && !expanded.has(row.page.id)) {
          event.preventDefault();
          toggleExpand(row.page.id);
        }
      } else if (key === "ArrowLeft") {
        if (row.hasChildren && expanded.has(row.page.id)) {
          event.preventDefault();
          toggleExpand(row.page.id);
        } else {
          const parentIndex = rows.findIndex(
            (candidate) => candidate.page.id === row.page.parentId,
          );
          if (parentIndex >= 0) {
            event.preventDefault();
            focusRow(parentIndex);
          }
        }
      } else if (key === "Enter") {
        event.preventDefault();
        onSelect(row.page.id);
      } else if (key === "F2" && canEdit) {
        event.preventDefault();
        onMenuAction({ kind: "rename", id: row.page.id });
      } else if ((key === "Delete" || key === "Backspace") && canEdit) {
        event.preventDefault();
        onMenuAction({ kind: "delete", id: row.page.id });
      }
    },
    [canEdit, expanded, focusRow, onMenuAction, onSelect, rows, toggleExpand],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 px-2">
        <span className="min-w-0 flex-1 truncate px-1 font-medium text-sm">
          {t("docs:tree.title")}
        </span>
        {canEdit && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label={t("docs:tree.newPage")}
            title={t("docs:tree.newPage")}
            onClick={() => onCreate(null)}
          >
            <Plus className="size-4" />
          </Button>
        )}
      </div>
      <div className="shrink-0 px-2 pb-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("docs:tree.searchPlaceholder")}
          aria-label={t("docs:tree.searchPlaceholder")}
          className="h-8"
        />
      </div>
      <div
        role="tree"
        aria-label={t("docs:tree.title")}
        className="min-h-0 flex-1 overflow-y-auto px-1 pb-2"
      >
        {rows.map((row, index) => {
          const isSelected = row.page.id === selectedId;
          const isOpen = expanded.has(row.page.id) && !query;
          const isRenaming = renamingId === row.page.id;
          return (
            <div
              key={row.page.id}
              ref={(element) => {
                rowRefs.current[index] = element;
              }}
              role="treeitem"
              aria-selected={isSelected}
              aria-level={row.depth + 1}
              aria-expanded={row.hasChildren ? isOpen : undefined}
              tabIndex={index === focusIndex ? 0 : -1}
              data-index={index}
              onKeyDown={(event) => handleTreeKeyDown(event, row, index)}
              onFocus={() => setFocusIndex(index)}
              className={cn(
                "group/menu-row flex h-8 w-full cursor-pointer items-center gap-1 rounded-md pr-1 outline-none transition-colors",
                "focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                isSelected
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-foreground/85 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              )}
              style={{ paddingLeft: `${8 + row.depth * 16}px` }}
              onClick={() => {
                setFocusIndex(index);
                onSelect(row.page.id);
              }}
            >
              {row.hasChildren && !query ? (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={t("docs:tree.more")}
                  className="flex size-5 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleExpand(row.page.id);
                  }}
                >
                  <ChevronRight
                    className={cn(
                      "size-4 transition-transform",
                      isOpen && "rotate-90",
                    )}
                  />
                </button>
              ) : (
                <ChevronRight
                  aria-hidden="true"
                  className="invisible size-5 shrink-0"
                />
              )}
              <FileText className="size-4 shrink-0 opacity-70" />
              {isRenaming ? (
                <Input
                  autoFocus
                  value={draft}
                  aria-label={t("docs:tree.rename")}
                  className="h-6 min-w-0 flex-1 px-1 text-sm"
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter") commitRename(row.page.id);
                    else if (event.key === "Escape") setRenamingId(null);
                  }}
                  onBlur={() => {
                    if (renamingId === row.page.id) commitRename(row.page.id);
                  }}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm">
                  {row.page.title.trim() || (
                    <span className="text-muted-foreground">
                      {t("docs:editor.untitled")}
                    </span>
                  )}
                </span>
              )}
              {!isRenaming && (
                <span className="flex shrink-0 items-center">
                  <PageMenu
                    pageId={row.page.id}
                    canEdit={canEdit}
                    onAction={onMenuAction}
                  />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
