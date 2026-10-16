import { describe, expect, it } from "vite-plus/test";
import {
  buildDocsTree,
  canMovePage,
  clampFocusIndex,
  DOCS_TREE_MAX_DEPTH,
  flattenDocsTree,
  getRelativeFocusIndex,
  isPageDescendant,
  type DocsPageLike,
} from "./docs-tree";

function page(
  id: string,
  parentId: string | null = null,
  position = 0,
): DocsPageLike {
  return { id, parentId, title: id, position, createdAt: "2026-01-01" };
}

describe("buildDocsTree", () => {
  it("nests children in sibling position order", () => {
    const roots = buildDocsTree([
      page("b", null, 2),
      page("a", null, 1),
      page("a2", "a", 2),
      page("a1", "a", 1),
    ]);
    expect(roots.map((node) => node.page.id)).toEqual(["a", "b"]);
    expect(roots[0]?.children.map((node) => node.page.id)).toEqual([
      "a1",
      "a2",
    ]);
  });

  it("attaches orphans and self-parented pages as roots", () => {
    const roots = buildDocsTree([
      page("orphan", "missing"),
      page("self", "self"),
    ]);
    expect(roots.map((node) => node.page.id).sort()).toEqual([
      "orphan",
      "self",
    ]);
  });

  it("breaks parent cycles by hoisting cyclic pages to roots", () => {
    const roots = buildDocsTree([page("a", "b"), page("b", "a")]);
    expect(roots.map((node) => node.page.id).sort()).toEqual(["a", "b"]);
    expect(roots.every((node) => node.children.length === 0)).toBe(true);
  });
});

describe("flattenDocsTree", () => {
  it("skips collapsed subtrees and caps depth", () => {
    const chain = [page("n0")];
    for (let depth = 1; depth <= 7; depth += 1) {
      chain.push(page(`n${depth}`, `n${depth - 1}`));
    }
    const roots = buildDocsTree(chain);
    const expanded = new Set(chain.map((node) => node.id));
    const rows = flattenDocsTree(roots, expanded);
    expect(rows).toHaveLength(8);
    expect(rows[rows.length - 1]?.depth).toBe(DOCS_TREE_MAX_DEPTH);
    expect(rows[rows.length - 1]?.page.id).toBe("n7");
  });

  it("hides children of collapsed nodes", () => {
    const roots = buildDocsTree([page("a"), page("a1", "a")]);
    const rows = flattenDocsTree(roots, new Set());
    expect(rows.map((row) => row.page.id)).toEqual(["a"]);
    expect(rows[0]?.hasChildren).toBe(true);
  });
});

describe("move-cycle guard", () => {
  const pages = [page("a"), page("b", "a"), page("c", "b")];

  it("detects descendants through several levels", () => {
    expect(isPageDescendant(pages, "c", "a")).toBe(true);
    expect(isPageDescendant(pages, "a", "c")).toBe(false);
    expect(isPageDescendant(pages, "a", "a")).toBe(false);
  });

  it("rejects moves under itself or its descendants", () => {
    expect(canMovePage(pages, "a", "a")).toBe(false);
    expect(canMovePage(pages, "a", "c")).toBe(false);
    expect(canMovePage(pages, "c", "a")).toBe(true);
    expect(canMovePage(pages, "c", null)).toBe(true);
  });
});

describe("keyboard nav index math", () => {
  it("clamps focus into the visible range without wrapping", () => {
    expect(clampFocusIndex(-1, 3)).toBe(0);
    expect(clampFocusIndex(3, 3)).toBe(2);
    expect(clampFocusIndex(1, 3)).toBe(1);
    expect(clampFocusIndex(0, 0)).toBe(-1);
  });

  it("moves focus by delta and stops at the ends", () => {
    expect(getRelativeFocusIndex(0, -1, 4)).toBe(0);
    expect(getRelativeFocusIndex(3, 1, 4)).toBe(3);
    expect(getRelativeFocusIndex(1, 1, 4)).toBe(2);
  });
});
