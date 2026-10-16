import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { pageTable, projectTable } from "../database/schema";
import { assertProjectAccess } from "../project-access/assert-project-access";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";

// Route middleware runs before the request validators, so these read the raw
// request rather than c.req.valid(), which is not populated yet.
async function authorizeScope(
  c: Context,
  scope: { projectId: string; workspaceId: string } | null,
  notFoundMessage: string,
) {
  if (!scope) {
    throw new HTTPException(404, { message: notFoundMessage });
  }

  const userId = c.get("userId");
  if (!userId) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  const apiKey = c.get("apiKey") as { id: string } | undefined;
  await validateWorkspaceAccess(userId, scope.workspaceId, apiKey?.id, {
    notFoundMessage,
  });
  try {
    await assertProjectAccess(userId, scope.projectId);
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) {
      throw new HTTPException(404, { message: notFoundMessage });
    }
    throw error;
  }

  c.set("workspaceId", scope.workspaceId);
}

// POST /api/page carries the project in the JSON body.
export async function scopeToPageProject(c: Context, next: Next) {
  const body = (await c.req.json().catch(() => ({}))) as {
    projectId?: unknown;
  };
  const projectId = typeof body?.projectId === "string" ? body.projectId : null;
  if (!projectId) {
    throw new HTTPException(400, {
      message: "Project ID could not be determined",
    });
  }

  const [project] = await db
    .select({ id: projectTable.id, workspaceId: projectTable.workspaceId })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);

  await authorizeScope(
    c,
    project
      ? { projectId: project.id, workspaceId: project.workspaceId }
      : null,
    "Project not found",
  );
  return next();
}

// PUT/DELETE /api/page/:id address the page by path param.
export async function scopeToPage(c: Context, next: Next) {
  const id = c.req.param("id") ?? "";

  const [page] = await db
    .select({
      projectId: pageTable.projectId,
      workspaceId: projectTable.workspaceId,
    })
    .from(pageTable)
    .innerJoin(projectTable, eq(pageTable.projectId, projectTable.id))
    .where(eq(pageTable.id, id))
    .limit(1);

  await authorizeScope(
    c,
    page ? { projectId: page.projectId, workspaceId: page.workspaceId } : null,
    "Page not found",
  );
  return next();
}
