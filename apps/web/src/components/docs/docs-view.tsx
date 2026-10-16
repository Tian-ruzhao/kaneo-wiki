import {
  ChevronRight,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useContext, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { DocsEditor, DocsEditorLoading } from "@/components/docs/docs-editor";
import {
  DocsTreePanel,
  PageMenu,
  type PageMenuAction,
} from "@/components/docs/docs-tree";
import { usePageCollab } from "@/components/docs/use-page-collab";
import { AuthContext } from "@/components/providers/auth-provider";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetTitle,
} from "@/components/ui/sheet";
import { useCreatePage } from "@/hooks/mutations/page/use-create-page";
import { useDeletePage } from "@/hooks/mutations/page/use-delete-page";
import { useUpdatePage } from "@/hooks/mutations/page/use-update-page";
import { useGetPages, type DocsPage } from "@/hooks/queries/page/use-get-pages";
import { cn } from "@/lib/cn";
import {
  buildDocsTree,
  canMovePage,
  flattenDocsTree,
  isPageDescendant,
} from "@/lib/docs-tree";
import { toast } from "@/lib/toast";
import { useUserPreferencesStore } from "@/store/user-preferences";

const TREE_PANEL_CLASSES =
  "hidden w-64 min-w-52 max-w-80 shrink-0 flex-col border-border/80 border-r bg-card/40 min-[900px]:flex";
const SYNC_DOT: Record<string, string> = {
  saved: "bg-emerald-500",
  saving: "bg-amber-500 animate-pulse",
  reconnecting: "bg-amber-500 animate-pulse",
  offline: "bg-destructive",
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0] ?? "?").slice(0, 2).toUpperCase();
  return `${(parts[0] ?? "?")[0] ?? ""}${(parts[parts.length - 1] ?? "?")[0] ?? ""}`.toUpperCase();
}

function ancestorChain(pages: DocsPage[], pageId: string): DocsPage[] {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const chain: DocsPage[] = [];
  const seen = new Set<string>();
  let current = byId.get(pageId) ?? null;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.parentId ? (byId.get(current.parentId) ?? null) : null;
  }
  return chain;
}

type DocsViewProps = {
  projectId: string;
  workspaceId: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

export function DocsView({
  projectId,
  workspaceId,
  selectedId,
  onSelect,
}: DocsViewProps) {
  const { t } = useTranslation();
  const user = useContext(AuthContext).user;
  const displayName = user?.name || user?.email || "Someone";
  const docsTreeOpen = useUserPreferencesStore((state) => state.docsTreeOpen);
  const setDocsTreeOpen = useUserPreferencesStore(
    (state) => state.setDocsTreeOpen,
  );

  const { data, isLoading, isError, refetch } = useGetPages(projectId);
  const pages = useMemo(() => data?.pages ?? [], [data]);
  const canEdit = data?.canEdit ?? false;

  const { mutateAsync: createPage, isPending: isCreating } =
    useCreatePage(projectId);
  const { mutateAsync: updatePage } = useUpdatePage(projectId);
  const { mutateAsync: deletePage, isPending: isDeleting } =
    useDeletePage(projectId);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [moveId, setMoveId] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<string>("__root__");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [renameSignal, setRenameSignal] = useState<{
    id: string;
    nonce: number;
  } | null>(null);

  const selectedPage = pages.find((page) => page.id === selectedId) ?? null;
  const selectedMissing =
    !isLoading && !isError && selectedId !== null && !selectedPage;

  const collab = usePageCollab({
    pageId: selectedPage?.id ?? null,
    displayName,
  });
  const showDeleted = selectedMissing || collab.deleted;

  const crumbs = useMemo(
    () => (selectedPage ? ancestorChain(pages, selectedPage.id) : []),
    [pages, selectedPage],
  );

  const handleSelect = (id: string) => {
    onSelect(id);
    setDrawerOpen(false);
  };

  const handleCreate = async (parentId: string | null) => {
    if (!canEdit) return;
    try {
      const created = await createPage({ parentId });
      toast.success(t("docs:toast.created"));
      onSelect(created.id);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("docs:error.loadFailed"),
      );
    }
  };

  const handleRename = async (id: string, title: string) => {
    try {
      await updatePage({ id, data: { title } });
      toast.success(t("docs:toast.renamed"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("docs:error.loadFailed"),
      );
    }
  };

  const handleCopyLink = async (id: string) => {
    const url = `${window.location.origin}/dashboard/workspace/${workspaceId}/project/${projectId}/docs?pageId=${encodeURIComponent(id)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("docs:toast.linkCopied"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("docs:error.loadFailed"),
      );
    }
  };

  const handleMenuAction = (action: PageMenuAction) => {
    switch (action.kind) {
      case "new-sub-page":
        void handleCreate(action.id);
        break;
      case "rename":
        setRenameSignal({ id: action.id, nonce: Date.now() });
        setDrawerOpen(true);
        break;
      case "copy-link":
        void handleCopyLink(action.id);
        break;
      case "move":
        setMoveTarget(
          pages.find((page) => page.id === action.id)?.parentId ?? "__root__",
        );
        setMoveId(action.id);
        break;
      case "delete":
        setDeleteId(action.id);
        break;
    }
  };

  const handleMoveConfirm = async () => {
    if (!moveId) return;
    const target = moveTarget === "__root__" ? null : moveTarget;
    try {
      await updatePage({ id: moveId, data: { parentId: target } });
      setMoveId(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("docs:error.loadFailed"),
      );
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteId) return;
    try {
      await deletePage(deleteId);
      toast.success(t("docs:toast.deleted"));
      setDeleteId(null);
      const remaining = pages.filter(
        (page) =>
          page.id !== deleteId && !isPageDescendant(pages, page.id, deleteId),
      );
      if (selectedId && !remaining.some((page) => page.id === selectedId)) {
        onSelect(remaining[0]?.id ?? null);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("docs:error.loadFailed"),
      );
    }
  };

  const treePanel = (onNavigate?: () => void) => (
    <DocsTreePanel
      pages={pages}
      selectedId={selectedPage?.id ?? null}
      canEdit={canEdit}
      renameSignal={renameSignal}
      onSelect={(id) => {
        handleSelect(id);
        onNavigate?.();
      }}
      onCreate={(parentId) => void handleCreate(parentId)}
      onRename={(id, title) => void handleRename(id, title)}
      onMenuAction={handleMenuAction}
    />
  );

  const syncLabel =
    collab.syncState === "saved"
      ? t("docs:sync.saved")
      : collab.syncState === "saving"
        ? t("docs:sync.saving")
        : collab.syncState === "offline"
          ? t("docs:sync.offline")
          : t("docs:sync.reconnecting");

  const moveOptions = useMemo(() => {
    if (!moveId) return [];
    const roots = buildDocsTree(pages);
    return flattenDocsTree(roots, new Set(pages.map((page) => page.id))).filter(
      (row) => canMovePage(pages, moveId, row.page.id),
    );
  }, [moveId, pages]);

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {docsTreeOpen ? (
        <aside className={TREE_PANEL_CLASSES}>
          <div className="flex min-h-0 flex-1 flex-col">
            {isLoading ? (
              <TreeSkeleton />
            ) : (
              <>
                <div className="flex justify-end px-2 pt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={t("common:a11y.toggleSidebar")}
                    title={t("common:a11y.toggleSidebar")}
                    onClick={() => setDocsTreeOpen(false)}
                  >
                    <PanelLeftClose className="size-4" />
                  </Button>
                </div>
                <div className="min-h-0 flex-1">{treePanel()}</div>
              </>
            )}
          </div>
        </aside>
      ) : (
        <div className="hidden w-10 shrink-0 flex-col items-center border-border/80 border-r bg-card/40 py-2 min-[900px]:flex">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t("common:a11y.toggleSidebar")}
            title={t("common:a11y.toggleSidebar")}
            onClick={() => setDocsTreeOpen(true)}
          >
            <PanelLeftOpen className="size-4" />
          </Button>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-border/80 border-b px-2 sm:px-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 min-[900px]:hidden"
            aria-label={t("common:a11y.toggleSidebar")}
            onClick={() => setDrawerOpen(true)}
          >
            <PanelLeft className="size-4" />
          </Button>
          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 flex-1 items-center gap-1 text-sm"
          >
            {crumbs.map((crumb, index) => (
              <span key={crumb.id} className="flex min-w-0 items-center gap-1">
                {index > 0 && (
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <button
                  type="button"
                  onClick={() => handleSelect(crumb.id)}
                  className={cn(
                    "truncate rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring",
                    index === crumbs.length - 1
                      ? "font-medium text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {crumb.title.trim() || t("docs:editor.untitled")}
                </button>
              </span>
            ))}
          </nav>
          {selectedPage && collab.doc && !showDeleted && (
            <div className="flex shrink-0 items-center gap-2">
              <span className="hidden items-center gap-1.5 text-muted-foreground text-xs sm:flex">
                <span
                  className={cn(
                    "size-2 rounded-full",
                    SYNC_DOT[collab.syncState],
                  )}
                />
                {syncLabel}
                {collab.syncState === "offline" && (
                  <button
                    type="button"
                    className="underline"
                    onClick={() => collab.retry()}
                  >
                    {t("docs:error.retry")}
                  </button>
                )}
              </span>
              {collab.peers.length > 0 && (
                <span className="flex items-center" role="status">
                  {collab.peers.slice(0, 3).map((peer) => (
                    <Avatar
                      key={peer.clientId}
                      className="-ml-1 size-6 border-2 border-background first:ml-0"
                      title={t("docs:presence.editing", { name: peer.name })}
                    >
                      <AvatarFallback
                        className="text-[10px]"
                        style={{ backgroundColor: peer.color, color: "#fff" }}
                      >
                        {initials(peer.name)}
                      </AvatarFallback>
                    </Avatar>
                  ))}
                  {collab.peers.length > 3 && (
                    <span className="-ml-1 flex size-6 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px] text-muted-foreground">
                      +{collab.peers.length - 3}
                    </span>
                  )}
                </span>
              )}
              <PageMenu
                pageId={selectedPage.id}
                canEdit={canEdit}
                onAction={handleMenuAction}
              />
            </div>
          )}
        </header>

        {!isLoading && !isError && !canEdit && pages.length > 0 && (
          <p className="shrink-0 border-border/80 border-b bg-muted/60 px-4 py-2 text-muted-foreground text-xs">
            {t("docs:noAccess.banner")}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <DocsEditorLoading />
          ) : isError ? (
            <div className="mx-auto max-w-[720px] px-4 py-16 text-center sm:px-8">
              <p role="alert" className="font-medium text-destructive text-sm">
                {t("docs:error.loadFailed")}{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => void refetch()}
                >
                  {t("docs:error.retry")}
                </button>
              </p>
            </div>
          ) : showDeleted ? (
            <div className="mx-auto max-w-[720px] px-4 py-16 text-center sm:px-8">
              <p className="font-semibold text-lg">{t("docs:deleted.title")}</p>
              <p className="mt-1 text-muted-foreground text-sm">
                {t("docs:deleted.message")}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => onSelect(pages[0]?.id ?? null)}
              >
                {t("docs:deleted.goHome")}
              </Button>
            </div>
          ) : pages.length === 0 ? (
            <div className="mx-auto max-w-[720px] px-4 py-16 text-center sm:px-8">
              <p className="font-semibold text-lg">{t("docs:empty.title")}</p>
              {canEdit && (
                <Button
                  type="button"
                  size="sm"
                  className="mt-4"
                  disabled={isCreating}
                  onClick={() => void handleCreate(null)}
                >
                  {t("docs:empty.cta")}
                </Button>
              )}
            </div>
          ) : selectedPage ? (
            collab.doc ? (
              <DocsEditor
                key={selectedPage.id}
                page={selectedPage}
                canEdit={canEdit}
                ydoc={collab.doc}
                onRenameTitle={(title) =>
                  void handleRename(selectedPage.id, title)
                }
              />
            ) : (
              <DocsEditorLoading />
            )
          ) : null}
        </div>
      </div>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetPopup side="left" className="w-72 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>{t("docs:tree.title")}</SheetTitle>
            <SheetDescription>{t("docs:tree.title")}</SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col">
            {isLoading ? <TreeSkeleton /> : treePanel()}
          </div>
        </SheetPopup>
      </Sheet>

      <Dialog
        open={moveId !== null}
        onOpenChange={(open) => {
          if (!open) setMoveId(null);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{t("docs:tree.move")}</DialogTitle>
            <DialogDescription>{t("docs:tree.title")}</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <RadioGroup
              value={moveTarget}
              onValueChange={setMoveTarget}
              aria-label={t("docs:tree.move")}
            >
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <RadioGroupItem value="__root__" />
                <span>{t("docs:tree.title")}</span>
              </label>
              {moveOptions.map((row) => (
                <label
                  key={row.page.id}
                  className="flex cursor-pointer items-center gap-2 text-sm"
                  style={{ paddingLeft: `${row.depth * 16}px` }}
                >
                  <RadioGroupItem value={row.page.id} />
                  <span className="truncate">
                    {row.page.title.trim() || t("docs:editor.untitled")}
                  </span>
                </label>
              ))}
            </RadioGroup>
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setMoveId(null)}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void handleMoveConfirm()}
            >
              {t("docs:tree.move")}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <AlertDialog
        open={deleteId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("docs:delete.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("docs:delete.confirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isDeleting}
              onClick={() => setDeleteId(null)}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={isDeleting}
              onClick={() => void handleDeleteConfirm()}
            >
              {isDeleting
                ? t("common:actions.deleting")
                : t("docs:delete.confirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TreeSkeleton() {
  return (
    <div className="flex flex-col gap-1 p-2" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          className="h-8 animate-pulse rounded-md bg-muted"
          style={{ marginLeft: `${(index % 3) * 16}px` }}
        />
      ))}
    </div>
  );
}
