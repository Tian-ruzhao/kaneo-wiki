import { HTTPException } from "hono/http-exception";
import { assertProjectAccess } from "../../project-access/assert-project-access";
import { validateWorkspaceAccess } from "../../utils/validate-workspace-access";

/**
 * Page access check that hides existence: workspace outsiders and members
 * without project access both observe a 404.
 */
export async function assertPageProjectAccess(
  userId: string,
  projectId: string,
  workspaceId: string,
  notFoundMessage = "Page not found",
): Promise<void> {
  await validateWorkspaceAccess(userId, workspaceId, undefined, {
    notFoundMessage,
  });
  try {
    await assertProjectAccess(userId, projectId);
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) {
      throw new HTTPException(404, { message: notFoundMessage });
    }
    throw error;
  }
}
