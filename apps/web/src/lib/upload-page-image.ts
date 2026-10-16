import createPageImageUpload, {
  finalizePageImageUpload,
} from "@/fetchers/page/upload-page-image";

const allowedImageMimeTypes = new Set([
  "image/apng",
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export function isSupportedPageImageFile(file: File) {
  return allowedImageMimeTypes.has(file.type.toLowerCase());
}

export function getPageImageAltText(filename: string) {
  return filename
    .replace(/\.[^/.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim();
}

export async function uploadPageImage({
  pageId,
  file,
}: {
  pageId: string;
  file: File;
}) {
  if (!isSupportedPageImageFile(file) || file.size <= 0) {
    throw new Error("Only non-empty image uploads are supported.");
  }

  const contentType = file.type || "application/octet-stream";

  const upload = await createPageImageUpload({
    pageId,
    filename: file.name || "image",
    contentType,
    size: file.size,
  });

  const response = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers: upload.headers,
    body: file,
  });

  if (!response.ok) {
    throw new Error("Failed to upload file to storage.");
  }

  const asset = await finalizePageImageUpload({
    pageId,
    key: upload.key,
    filename: file.name || "image",
    contentType,
    size: file.size,
  });

  return {
    url: asset.url,
    alt: getPageImageAltText(file.name || "image"),
    filename: file.name || "file",
    kind: "image" as const,
    mimeType: contentType,
    size: file.size,
  };
}
