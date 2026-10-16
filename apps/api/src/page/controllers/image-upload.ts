import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { pageTable, projectTable, workspaceTable } from "../../database/schema";
import {
  createPageImageUploadUrl,
  validateTaskAssetUploadInput,
} from "../../storage/s3";

export type PageImageContext = {
  pageId: string;
  projectId: string;
  workspaceId: string;
};

export async function resolvePageImageContext(
  id: string,
): Promise<PageImageContext> {
  const [pageContext] = await db
    .select({
      pageId: pageTable.id,
      projectId: pageTable.projectId,
      workspaceId: workspaceTable.id,
    })
    .from(pageTable)
    .innerJoin(projectTable, eq(pageTable.projectId, projectTable.id))
    .innerJoin(workspaceTable, eq(projectTable.workspaceId, workspaceTable.id))
    .where(eq(pageTable.id, id))
    .limit(1);

  if (!pageContext) {
    throw new HTTPException(404, { message: "Page not found" });
  }

  return pageContext;
}

async function createPageImageUpload(
  id: string,
  input: { filename: string; contentType: string; size: number },
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

  try {
    return await createPageImageUploadUrl({
      workspaceId: pageContext.workspaceId,
      projectId: pageContext.projectId,
      pageId: pageContext.pageId,
      filename: input.filename,
      contentType: input.contentType,
      size: input.size,
    });
  } catch (error) {
    throw new HTTPException(503, {
      message:
        error instanceof Error
          ? error.message
          : "Image uploads are not configured",
    });
  }
}

export default createPageImageUpload;
