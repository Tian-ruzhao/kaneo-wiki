import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { formatDateTime } from "@/lib/format";
import { DocsPageMeta } from "./docs-page-meta";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      if (key === "docs:meta.edited") {
        return `${options?.name} edited ${options?.date}`;
      }
      if (key === "docs:meta.editedNoName") {
        return `Edited ${options?.date}`;
      }
      return key;
    },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const UPDATED_AT = "2026-10-16T14:28:00.000Z";

describe("DocsPageMeta", () => {
  it("renders the avatar initial, name and date", () => {
    const view = render(
      <DocsPageMeta
        updatedBy={{ id: "user-1", name: "Ada Lovelace" }}
        updatedAt={UPDATED_AT}
      />,
    );
    try {
      const expectedDate = formatDateTime(UPDATED_AT);
      expect(view.container.textContent).toContain("Ada Lovelace");
      expect(view.container.textContent).toContain(expectedDate);
      // Avatar shows the editor's initial.
      expect(view.container.textContent).toContain("A");
      expect(
        view.container.querySelector('[data-slot="avatar"]'),
      ).not.toBeNull();
    } finally {
      view.unmount();
    }
  });

  it("renders only the date when there is no editor", () => {
    const view = render(
      <DocsPageMeta updatedBy={null} updatedAt={UPDATED_AT} />,
    );
    try {
      const expectedDate = formatDateTime(UPDATED_AT);
      expect(view.container.textContent).toContain(`Edited ${expectedDate}`);
      expect(view.container.textContent).not.toContain("Ada");
      expect(view.container.querySelector('[data-slot="avatar"]')).toBeNull();
    } finally {
      view.unmount();
    }
  });

  it("renders nothing when both editor and date are missing", () => {
    const view = render(<DocsPageMeta updatedBy={null} />);
    try {
      expect(view.container.innerHTML).toBe("");
    } finally {
      view.unmount();
    }
  });

  it("renders the editor name even without a date", () => {
    const view = render(
      <DocsPageMeta updatedBy={{ id: "user-2", name: "Grace" }} />,
    );
    try {
      expect(view.container.textContent).toContain("Grace");
    } finally {
      view.unmount();
    }
  });
});
