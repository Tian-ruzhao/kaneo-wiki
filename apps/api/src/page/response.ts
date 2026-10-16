import type { pageTable } from "../database/schema";
import { responseTimestamp, z } from "../openapi";

export const pageSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    parentId: z.string().nullable(),
    title: z.string(),
    position: z.number().int(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
    updatedBy: z
      .object({ id: z.string(), name: z.string() })
      .nullable()
      .openapi({
        description:
          "Last editor of the page (title/metadata or collaborative content), or null when unknown.",
      }),
  })
  .openapi("Page");

export const pageListSchema = z
  .object({ pages: z.array(pageSchema), canEdit: z.boolean() })
  .openapi("PageList");

export const pageImageUploadSchema = z
  .object({
    key: z.string().openapi({
      description: "Object key to send back to the finalize route.",
    }),
    uploadUrl: z.string().openapi({
      description: "Presigned URL to PUT the image bytes to.",
    }),
    headers: z.record(z.string(), z.string()).openapi({
      description:
        "Headers that must accompany the upload request, including Content-Type.",
    }),
  })
  .openapi("PageImageUpload");

export const finalizedPageAssetSchema = z
  .object({
    id: z.string(),
    url: z.string().openapi({
      description: "Where the stored image can be read back from.",
    }),
  })
  .openapi("PageImageAsset");

export type PublicPageRow = Pick<
  typeof pageTable.$inferSelect,
  | "id"
  | "projectId"
  | "parentId"
  | "title"
  | "position"
  | "createdAt"
  | "updatedAt"
  | "updatedBy"
> & { updatedByName: string | null };

export function toPublicPage(page: PublicPageRow) {
  return {
    id: page.id,
    projectId: page.projectId,
    parentId: page.parentId,
    title: page.title,
    position: page.position,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
    updatedBy:
      page.updatedBy && page.updatedByName
        ? { id: page.updatedBy, name: page.updatedByName }
        : null,
  };
}
