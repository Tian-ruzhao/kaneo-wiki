import { asc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { pageTable, projectTable } from "../../database/schema";
import { toPublicPage } from "../response";
import { assertPageProjectAccess } from "./access";

async function listPages(projectId: string, userId: string) {
  const [project] = await db
    .select({ id: projectTable.id, workspaceId: projectTable.workspaceId })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);

  if (!project) {
    throw new HTTPException(404, { message: "Project not found" });
  }

  await assertPageProjectAccess(
    userId,
    projectId,
    project.workspaceId,
    "Project not found",
  );

  const pages = await db
    .select({
      id: pageTable.id,
      projectId: pageTable.projectId,
      parentId: pageTable.parentId,
      title: pageTable.title,
      position: pageTable.position,
      createdAt: pageTable.createdAt,
      updatedAt: pageTable.updatedAt,
    })
    .from(pageTable)
    .where(eq(pageTable.projectId, projectId))
    .orderBy(asc(pageTable.position), asc(pageTable.createdAt));

  return { pages: pages.map(toPublicPage), workspaceId: project.workspaceId };
}

export default listPages;
