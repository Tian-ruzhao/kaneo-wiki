import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { pageTable, projectTable } from "../../database/schema";
import { evictPageRoom } from "../room";
import { assertPageProjectAccess } from "./access";

async function deletePage(userId: string, id: string) {
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

  // Children cascade via the parent_id foreign key; drop any cached Y.Doc so
  // a reconnect reloads (or 404s) instead of resurrecting deleted content.
  await evictPageRoom(id);

  await db.delete(pageTable).where(eq(pageTable.id, id));

  return { success: true as const };
}

export default deletePage;
