import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { NodeViewProps } from "@tiptap/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  buildImageDownloadFilename,
  DocsImage,
  DocsImageNodeView,
  downloadNodeImage,
} from "./docs-image";

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/lib/toast", () => ({
  toast: { error: mocks.toastError },
}));

function makeChain() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.focus = vi.fn(() => chain);
  chain.deleteSelection = vi.fn(() => chain);
  chain.setTextSelection = vi.fn(() => chain);
  chain.run = vi.fn(() => true);
  return chain;
}

function makeEditor(isEditable: boolean) {
  const chain = makeChain();
  const editor = {
    isEditable,
    isDestroyed: false,
    state: { doc: { content: { size: 20 } } },
    on: vi.fn(),
    off: vi.fn(),
    commands: { setNodeSelection: vi.fn() },
    chain: vi.fn(() => chain),
  };
  return { editor, chain };
}

function makeProps(
  editor: unknown,
  overrides: { selected?: boolean; attrs?: Record<string, unknown> } = {},
) {
  return {
    editor,
    node: {
      attrs: {
        src: "http://localhost:1337/api/asset/asset-1",
        alt: "Holiday photo",
        title: null,
        ...overrides.attrs,
      },
      nodeSize: 2,
    },
    selected: overrides.selected ?? true,
    getPos: () => 4,
    updateAttributes: vi.fn(),
  } as unknown as NodeViewProps;
}

function renderNodeView(isEditable: boolean, selected = true) {
  const { editor, chain } = makeEditor(isEditable);
  const view = render(
    <DocsImageNodeView {...makeProps(editor, { selected })} />,
  );
  return { ...view, editor, chain };
}

describe("DocsImageNodeView", () => {
  beforeEach(() => {
    mocks.toastError.mockReset();
  });

  it("shows the toolbar with all three actions when selected and editable", () => {
    const { unmount } = renderNodeView(true, true);
    try {
      expect(screen.getByRole("toolbar")).toHaveAttribute(
        "aria-label",
        "docs:image.toolbar",
      );
      expect(
        screen.getByRole("button", { name: "docs:image.enlarge" }),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "docs:image.download" }),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "docs:image.delete" }),
      ).toBeTruthy();
      // Visible selected state on the image itself.
      const img = screen.getByAltText("Holiday photo");
      expect(img.getAttribute("data-selected")).toBe("true");
      expect(img.className).toContain("outline-primary");
    } finally {
      unmount();
    }
  });

  it("hides the toolbar when the image is not selected", () => {
    const { container, unmount } = renderNodeView(true, false);
    try {
      expect(container.querySelector('[role="toolbar"]')).toBeNull();
      const img = container.querySelector("img");
      expect(img?.getAttribute("data-selected")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("shows enlarge and download but not delete when read-only", () => {
    const { unmount } = renderNodeView(false, true);
    try {
      expect(
        screen.getByRole("button", { name: "docs:image.enlarge" }),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "docs:image.download" }),
      ).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: "docs:image.delete" }),
      ).toBeNull();
    } finally {
      unmount();
    }
  });

  it("deletes through the editor selection so Yjs syncs it", () => {
    const { chain, unmount } = renderNodeView(true, true);
    try {
      fireEvent.click(
        screen.getByRole("button", { name: "docs:image.delete" }),
      );
      expect(chain.focus).toHaveBeenCalled();
      expect(chain.deleteSelection).toHaveBeenCalled();
      expect(chain.run).toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it("opens the enlarge dialog and closes it again", async () => {
    const { unmount } = renderNodeView(true, true);
    try {
      fireEvent.click(
        screen.getByRole("button", { name: "docs:image.enlarge" }),
      );
      await waitFor(() => expect(screen.getByRole("dialog")).not.toBeNull());
      fireEvent.click(screen.getByRole("button", { name: "docs:image.close" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    } finally {
      unmount();
    }
  });

  it("deselects with Escape by moving the text selection past the node", () => {
    const { chain, container, unmount } = renderNodeView(true, true);
    try {
      const wrapper = container.querySelector("[data-node-view-wrapper]");
      if (!wrapper) throw new Error("node view wrapper missing");
      fireEvent.keyDown(wrapper, { key: "Escape" });
      expect(chain.setTextSelection).toHaveBeenCalledWith(6);
    } finally {
      unmount();
    }
  });
});

describe("buildImageDownloadFilename", () => {
  it("prefers alt text and adds the blob extension", () => {
    expect(
      buildImageDownloadFilename(
        { src: "http://localhost:1337/api/asset/abc", alt: "Holiday photo" },
        "image/png",
      ),
    ).toBe("Holiday photo.png");
  });

  it("falls back to title, then the URL segment, then a default name", () => {
    expect(
      buildImageDownloadFilename(
        {
          src: "http://localhost:1337/api/asset/abc",
          title: "Board scan",
        },
        "image/jpeg",
      ),
    ).toBe("Board scan.jpg");
    expect(
      buildImageDownloadFilename(
        { src: "http://localhost:1337/api/asset/report-final.webp?v=2" },
        "image/webp",
      ),
    ).toBe("report-final.webp");
    expect(buildImageDownloadFilename({ src: "" }, null)).toBe("image");
  });

  it("keeps an existing extension instead of appending another", () => {
    expect(
      buildImageDownloadFilename(
        { src: "http://localhost:1337/api/asset/abc", alt: "logo.svg" },
        "image/png",
      ),
    ).toBe("logo.svg");
  });
});

describe("downloadNodeImage", () => {
  const realCreateObjectURL = URL.createObjectURL;
  const realRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    vi.unstubAllGlobals();
    mocks.toastError.mockReset();
  });

  function mockDownload(blobType: string) {
    const blob = new Blob(["fake-image-bytes"], { type: blobType });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, blob: async () => blob })),
    );
    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: revokeObjectURL,
    });
    const clicks: Array<{ href: string; download: string }> = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicks.push({ href: this.href, download: this.download });
      });
    return { createObjectURL, revokeObjectURL, clicks, clickSpy };
  }

  function restoreUrls() {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: realCreateObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: realRevokeObjectURL,
    });
  }

  it("fetches with credentials, builds a filename and triggers a download", async () => {
    const { createObjectURL, revokeObjectURL, clicks, clickSpy } =
      mockDownload("image/png");
    try {
      await downloadNodeImage({
        src: "http://localhost:1337/api/asset/asset-1",
        alt: "Holiday photo",
      });
      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:1337/api/asset/asset-1",
        { credentials: "include" },
      );
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(clicks).toHaveLength(1);
      expect(clicks[0]?.download).toBe("Holiday photo.png");
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    } finally {
      clickSpy.mockRestore();
      restoreUrls();
    }
  });

  it("shows a toast error when the download fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    try {
      await downloadNodeImage(
        { src: "http://localhost:1337/api/asset/asset-1", alt: "x" },
        { onError: () => mocks.toastError("docs:image.downloadFailed") },
      );
      expect(mocks.toastError).toHaveBeenCalledWith(
        "docs:image.downloadFailed",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("DocsImage", () => {
  it("keeps the stock image node name so Yjs documents sync untouched", () => {
    expect(DocsImage.name).toBe("image");
  });
});
