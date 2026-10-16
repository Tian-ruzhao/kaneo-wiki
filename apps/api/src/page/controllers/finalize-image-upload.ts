import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { assetTable } from "../../database/schema";
import { withVerifiedStorageObject } from "../../storage/cleanup-queue";
import {
  assertPageImageKeyMatchesContext,
  InvalidUploadedAssetError,
  isImageContentType,
  validateTaskAssetUploadInput,
  verifyTaskAssetUpload,
} from "../../storage/s3";
import { resolvePageImageContext } from "./image-upload";

async function finalizePageImageUpload(
  userId: string,
  id: string,
  input: { key: string; filename: string; contentType: string; size: number },
  apiBaseUrl: string,
) {
  try {
    validateTaskAssetUploadInput(input.contentType, input.size);
  } catch (error) {
    throw new HTTPException(400, {
      message:
        error instanceof Error ? error.message : "Invalid image upload request",
    });
  }

  const pageContext = await resolvePageImageContext(id);

  const normalizedKey = input.key.trim();
  if (
    !assertPageImageKeyMatchesContext(normalizedKey, {
      workspaceId: pageContext.workspaceId,
      projectId: pageContext.projectId,
      pageId: pageContext.pageId,
    })
  ) {
    throw new HTTPException(400, {
      message: "Image upload key does not match the page context.",
    });
  }

  const asset = await withVerifiedStorageObject(
    normalizedKey,
    async () => {
      try {
        return await verifyTaskAssetUpload(normalizedKey, {
          size: input.size,
          contentType: input.contentType,
        });
      } catch (error) {
        throw new HTTPException(
          error instanceof InvalidUploadedAssetError ? 400 : 503,
          {
            message:
              error instanceof InvalidUploadedAssetError
                ? error.message
                : "Unable to verify uploaded object.",
          },
        );
      }
    },
    async (tx, uploaded) => {
      const [existingAsset] = await tx
        .select({ id: assetTable.id })
        .from(assetTable)
        .where(eq(assetTable.objectKey, normalizedKey))
        .limit(1);

      const values = {
        workspaceId: pageContext.workspaceId,
        projectId: pageContext.projectId,
        pageId: pageContext.pageId,
        filename: input.filename,
        mimeType: uploaded.contentType,
        size: uploaded.size,
        kind: isImageContentType(uploaded.contentType) ? "image" : "attachment",
        surface: "description",
        createdBy: userId || null,
      };

      const [saved] = existingAsset
        ? await tx
            .update(assetTable)
            .set(values)
            .where(eq(assetTable.id, existingAsset.id))
            .returning({ id: assetTable.id })
        : await tx
            .insert(assetTable)
            .values({ ...values, objectKey: normalizedKey })
            .returning({ id: assetTable.id });

      return saved;
    },
  );

  if (!asset) {
    throw new HTTPException(500, {
      message: "Failed to save asset",
    });
  }

  return {
    id: asset.id,
    url: `${apiBaseUrl}/asset/${asset.id}`,
  };
}

export default finalizePageImageUpload;
