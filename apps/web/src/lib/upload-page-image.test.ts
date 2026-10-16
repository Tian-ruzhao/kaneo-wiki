import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { uploadPageImage } from "./upload-page-image";

const mocks = vi.hoisted(() => ({
  createPageImageUpload: vi.fn(),
  finalizePageImageUpload: vi.fn(),
}));

vi.mock("@/fetchers/page/upload-page-image", () => ({
  default: mocks.createPageImageUpload,
  finalizePageImageUpload: mocks.finalizePageImageUpload,
}));

describe("uploadPageImage", () => {
  beforeEach(() => {
    mocks.createPageImageUpload.mockResolvedValue({
      key: "page/image.png",
      uploadUrl: "https://storage.example/upload",
      headers: {},
    });
    mocks.finalizePageImageUpload.mockResolvedValue({
      id: "asset-1",
      url: "https://storage.example/image.png",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("rejects non-image files without calling the upload endpoints", async () => {
    const file = new File(["server config"], "server.conf");

    await expect(uploadPageImage({ pageId: "page-1", file })).rejects.toThrow();
    expect(mocks.createPageImageUpload).not.toHaveBeenCalled();
    expect(mocks.finalizePageImageUpload).not.toHaveBeenCalled();
  });

  it("presigns, PUTs the bytes, then finalizes and returns the asset", async () => {
    const file = new File(["image"], "my-photo.png", { type: "image/png" });

    const asset = await uploadPageImage({ pageId: "page-1", file });

    expect(mocks.createPageImageUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: "page-1",
        filename: "my-photo.png",
        contentType: "image/png",
      }),
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://storage.example/upload",
      expect.objectContaining({ method: "PUT", body: file }),
    );
    expect(mocks.finalizePageImageUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: "page-1",
        key: "page/image.png",
        contentType: "image/png",
      }),
    );
    expect(asset.url).toBe("https://storage.example/image.png");
    expect(asset.alt).toBe("my photo");
    expect(asset.kind).toBe("image");
    expect(asset.mimeType).toBe("image/png");
  });

  it("throws when the storage PUT fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const file = new File(["image"], "image.png", { type: "image/png" });

    await expect(uploadPageImage({ pageId: "page-1", file })).rejects.toThrow(
      "Failed to upload file to storage.",
    );
    expect(mocks.finalizePageImageUpload).not.toHaveBeenCalled();
  });
});
