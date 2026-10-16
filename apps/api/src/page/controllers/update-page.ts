import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { pageTable, projectTable } from "../../database/schema";
import { toPublicPage } from "../response";
import { assertPageProjectAccess } from "./access";

async function isDescendantOf(
  pageId: string,
  ancestorId: string,
): Promise<boolean> {
  let currentId: string | null = pageId;
  const seen = new Set<string>();
  while (currentId !== null) {
    if (currentId === ancestorId) return true;
    if (seen.has(currentId)) break;
    seen.add(currentId);
    const [row] = await db
      .select({ parentId: pageTable.parentId })
      .from(pageTable)
      .where(eq(pageTable.id, currentId))
      .limit(1);
    if (!row) break;
    currentId = row.parentId;
  }
  return false;
}

async function updatePage(
  userId: string,
  id: string,
  input: { title?: string; parentId?: string | null; position?: number },
) {
  const [existing] = await db
    .select({
      id: pageTable.id,
      projectId: pageTable.projectId,
      workspaceId: projectTable.workspaceId,
    })
    .from(pageTable)
    .innerJoin(projectTable, eq(pageTable.projectId, projectTable.id))
    .where(eq(pageTable.id, id))
    .limit(1);

  if (!existing) {
    throw new HTTPException(404, { message: "Page not found" });
  }

  await assertPageProjectAccess(
    userId,
    existing.projectId,
    existing.workspaceId,
  );

  const patch: Partial<typeof pageTable.$inferInsert> = {};

  if (input.title !== undefined) {
    patch.title = input.title;
  }

  if (input.position !== undefined) {
    patch.position = input.position;
  }

  if (input.parentId !== undefined) {
    if (input.parentId === null) {
      patch.parentId = null;
    } else {
      if (input.parentId === id) {
        throw new HTTPException(400, {
          message: "A page cannot be its own parent",
        });
      }
      const [parent] = await db
        .select({ id: pageTable.id, projectId: pageTable.projectId })
        .from(pageTable)
        .where(eq(pageTable.id, input.parentId))
        .limit(1);

      if (!parent || parent.projectId !== existing.projectId) {
        throw new HTTPException(400, { message: "Invalid parentId" });
      }
      if (await isDescendantOf(parent.id, id)) {
        throw new HTTPException(400, {
          message: "A page cannot be moved under its own descendant",
        });
      }
      patch.parentId = parent.id;
    }
  }

  const [updated] = await db
    .update(pageTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(pageTable.id, id))
    .returning();

  if (!updated) {
    throw new HTTPException(404, { message: "Page not found" });
  }

  return toPublicPage(updated);
}

export default updatePage;
