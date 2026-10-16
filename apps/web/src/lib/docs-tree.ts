export type DocsPageLike = {
  id: string;
  parentId: string | null;
  title: string;
  position: number;
  createdAt: string | number | Date;
};

export type DocsTreeNode<T extends DocsPageLike = DocsPageLike> = {
  page: T;
  children: DocsTreeNode<T>[];
};

export type DocsFlatNode<T extends DocsPageLike = DocsPageLike> = {
  page: T;
  depth: number;
  hasChildren: boolean;
};

/** Tree rows indent 8px + depth * 16px; depth never renders past this cap. */
export const DOCS_TREE_MAX_DEPTH = 5;

function comparePosition(a: DocsPageLike, b: DocsPageLike) {
  if (a.position !== b.position) return a.position - b.position;
  return String(a.createdAt).localeCompare(String(b.createdAt));
}

/**
 * Build a forest from a flat page list in sibling order. Orphan pages whose
 * parent is missing, and pages whose parent chain contains a cycle, are
 * attached as roots so no page ever disappears from the tree.
 */
export function buildDocsTree<T extends DocsPageLike>(
  pages: readonly T[],
): DocsTreeNode<T>[] {
  const sorted = [...pages].sort(comparePosition);
  const byId = new Map<string, T>();
  for (const page of sorted) byId.set(page.id, page);
  const nodes = new Map<string, DocsTreeNode<T>>();
  for (const page of sorted) nodes.set(page.id, { page, children: [] });

  // A page is a root when its parent chain ends (null/missing) or loops.
  const isRoot = (page: T): boolean => {
    const seen = new Set<string>([page.id]);
    let parentId = page.parentId;
    while (parentId !== null) {
      if (seen.has(parentId)) return true;
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) return true;
      parentId = parent.parentId;
    }
    return false;
  };

  const roots: DocsTreeNode<T>[] = [];
  for (const node of nodes.values()) {
    const parentId = node.page.parentId;
    const parent =
      parentId === null || isRoot(node.page)
        ? null
        : (nodes.get(parentId) ?? null);
    if (!parent) {
      roots.push(node);
      continue;
    }
    parent.children.push(node);
  }
  return roots;
}

/**
 * Flatten the forest into visible rows. Collapsed subtrees are skipped.
 * Render depth is capped at DOCS_TREE_MAX_DEPTH.
 */
export function flattenDocsTree<T extends DocsPageLike>(
  roots: readonly DocsTreeNode<T>[],
  expanded: ReadonlySet<string>,
  maxDepth: number = DOCS_TREE_MAX_DEPTH,
): DocsFlatNode<T>[] {
  const rows: DocsFlatNode<T>[] = [];
  const visit = (nodes: readonly DocsTreeNode<T>[], depth: number) => {
    for (const node of nodes) {
      const capped = Math.min(depth, maxDepth);
      rows.push({
        page: node.page,
        depth: capped,
        hasChildren: node.children.length > 0,
      });
      if (node.children.length > 0 && expanded.has(node.page.id)) {
        visit(node.children, depth + 1);
      }
    }
  };
  visit(roots, 0);
  return rows;
}

/**
 * True when `pageId` is a strict descendant of `maybeAncestorId`,
 * following parentId links. Guards against corrupt cycles.
 */
export function isPageDescendant(
  pages: readonly DocsPageLike[],
  pageId: string,
  maybeAncestorId: string,
): boolean {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const seen = new Set<string>();
  let current = byId.get(pageId)?.parentId ?? null;
  while (current !== null && !seen.has(current)) {
    if (current === maybeAncestorId) return true;
    seen.add(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return false;
}

/**
 * Move-cycle guard for the move dialog: a page can never be moved under
 * itself or one of its descendants.
 */
export function canMovePage(
  pages: readonly DocsPageLike[],
  pageId: string,
  targetParentId: string | null,
): boolean {
  if (targetParentId === null) return true;
  if (targetParentId === pageId) return false;
  return !isPageDescendant(pages, targetParentId, pageId);
}

/**
 * Clamp a roving-tabindex focus index into the visible row range.
 * ArrowUp/Down stop at the first/last row instead of wrapping.
 */
export function clampFocusIndex(index: number, total: number): number {
  if (total <= 0) return -1;
  if (index < 0) return 0;
  if (index >= total) return total - 1;
  return index;
}

/** Move focus by a delta (-1 / +1), clamped to the visible rows. */
export function getRelativeFocusIndex(
  current: number,
  delta: number,
  total: number,
): number {
  return clampFocusIndex(current + delta, total);
}
