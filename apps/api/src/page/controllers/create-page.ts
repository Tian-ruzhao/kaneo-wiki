import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { pageTable, projectTable } from "../../database/schema";
import { toPublicPage } from "../response";
import { assertPageProjectAccess } from "./access";

async function createPage(
  userId: string,
  input: { projectId: string; parentId?: string | null; title?: string },
) {
  const [project] = await db
    .select({ id: projectTable.id, workspaceId: projectTable.workspaceId })
    .from(projectTable)
    .where(eq(projectTable.id, input.projectId))
    .limit(1);

  if (!project) {
    throw new HTTPException(404, { message: "Project not found" });
  }

  await assertPageProjectAccess(
    userId,
    input.projectId,
    project.workspaceId,
    "Project not found",
  );

  let parentId: string | null = null;
  if (input.parentId !== undefined && input.parentId !== null) {
    const [parent] = await db
      .select({ id: pageTable.id, projectId: pageTable.projectId })
      .from(pageTable)
      .where(eq(pageTable.id, input.parentId))
      .limit(1);

    if (!parent || parent.projectId !== input.projectId) {
      throw new HTTPException(400, { message: "Invalid parentId" });
    }
    parentId = parent.id;
  }

  const [created] = await db
    .insert(pageTable)
    .values({
      projectId: input.projectId,
      parentId,
      title: input.title ?? "",
      createdBy: userId,
    })
    .returning();

  if (!created) {
    throw new HTTPException(500, { message: "Failed to create page" });
  }

  return toPublicPage(created);
}

export default createPage;
