import { describe, expect, it } from "vite-plus/test";
import { DOCS_BACKGROUND_COLORS, DOCS_FONT_COLORS } from "./text-colors";

const HEX = /^#[0-9A-Fa-f]{6}$/;

describe("text-colors", () => {
  it("defines a font palette with a default plus seven hues", () => {
    expect(DOCS_FONT_COLORS.map((entry) => entry.id)).toEqual([
      "default",
      "red",
      "orange",
      "yellow",
      "green",
      "blue",
      "purple",
      "grey",
    ]);
    for (const entry of DOCS_FONT_COLORS) {
      expect(entry.label.startsWith("docs:color.")).toBe(true);
      expect(entry.value).toMatch(HEX);
    }
  });

  it("defines a background palette with none, seven tints and seven stronger hues", () => {
    expect(DOCS_BACKGROUND_COLORS).toHaveLength(15);
    const [none, ...rest] = DOCS_BACKGROUND_COLORS;
    expect(none?.id).toBe("none");
    expect(none?.value).toBe("");
    expect(rest).toHaveLength(14);
    const ids = rest.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of rest) {
      expect(entry.label.startsWith("docs:color.")).toBe(true);
      expect(entry.value).toMatch(HEX);
    }
  });
});
