export type DocsTextColor = {
  /** Stable id used for keys and tests. */
  id: string;
  /** Static i18n key under docs:color.* (e.g. "docs:color.red"). */
  label: string;
  /** Hex swatch value. The "default" font entry renders as the unset mark. */
  value: string;
};

/**
 * Font colours. Values sit at the 600 level so they read on both light and
 * dark surfaces. The "default" entry carries the plain-text swatch value but
 * is applied as `unsetColor()` (inherit the theme foreground).
 */
export const DOCS_FONT_COLORS: DocsTextColor[] = [
  { id: "default", label: "docs:color.default", value: "#000000" },
  { id: "red", label: "docs:color.red", value: "#DC2626" },
  { id: "orange", label: "docs:color.orange", value: "#EA580C" },
  { id: "yellow", label: "docs:color.yellow", value: "#CA8A04" },
  { id: "green", label: "docs:color.green", value: "#16A34A" },
  { id: "blue", label: "docs:color.blue", value: "#2563EB" },
  { id: "purple", label: "docs:color.purple", value: "#9333EA" },
  { id: "grey", label: "docs:color.grey", value: "#6B7280" },
];

export type DocsBackgroundColor = {
  /** Stable id used for keys and tests. */
  id: string;
  /** Static i18n key under docs:color.* (e.g. "docs:color.backgroundRed"). */
  label: string;
  /**
   * Hex swatch value. Empty string means "no background" and is applied as
   * `unsetHighlight()`.
   */
  value: string;
};

/**
 * Background colours: no fill, then seven light tints, then the same seven
 * hues one step stronger (Feishu-style two-row panel).
 */
export const DOCS_BACKGROUND_COLORS: DocsBackgroundColor[] = [
  { id: "none", label: "docs:color.none", value: "" },
  { id: "grey-light", label: "docs:color.grey", value: "#F3F4F6" },
  { id: "red-light", label: "docs:color.red", value: "#FEE2E2" },
  { id: "orange-light", label: "docs:color.orange", value: "#FFEDD5" },
  { id: "yellow-light", label: "docs:color.yellow", value: "#FEF9C3" },
  { id: "green-light", label: "docs:color.green", value: "#DCFCE7" },
  { id: "blue-light", label: "docs:color.blue", value: "#DBEAFE" },
  { id: "purple-light", label: "docs:color.purple", value: "#F3E8FF" },
  { id: "grey", label: "docs:color.grey", value: "#D1D5DB" },
  { id: "red", label: "docs:color.red", value: "#FCA5A5" },
  { id: "orange", label: "docs:color.orange", value: "#FDBA74" },
  { id: "yellow", label: "docs:color.yellow", value: "#FDE047" },
  { id: "green", label: "docs:color.green", value: "#86EFAC" },
  { id: "blue", label: "docs:color.blue", value: "#93C5FD" },
  { id: "purple", label: "docs:color.purple", value: "#C4B5FD" },
];
