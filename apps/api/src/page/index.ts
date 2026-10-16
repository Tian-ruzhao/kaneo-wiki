import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import {
  hasWorkspacePermission,
  requireWorkspacePermission,
} from "../utils/require-workspace-permission";
import { normalizeApiServerUrl } from "../utils/openapi-spec";
import createPage from "./controllers/create-page";
import deletePage from "./controllers/delete-page";
import finalizePageImageUpload from "./controllers/finalize-image-upload";
import createPageImageUpload from "./controllers/image-upload";
import listPages from "./controllers/list-pages";
import updatePage from "./controllers/update-page";
import {
  finalizedPageAssetSchema,
  pageImageUploadSchema,
  pageListSchema,
  pageSchema,
} from "./response";
import { scopeToPage, scopeToPageProject } from "./scope";
import {
  createPageBody,
  finalizePageImageUploadBody,
  pageImageUploadBody,
  pageParam,
  projectIdParam,
  updatePageBody,
} from "./schema";

// Page writes require the same permission as editing tasks: viewers
// (task:read) can read pages but cannot create, update, or delete them.
const requirePageEdit = requireWorkspacePermission({ task: ["update"] });

const listProjectPagesRoute = createRoute({
  method: "get",
  operationId: "listProjectPages",
  path: "/project/{projectId}",
  tags: ["Pages"],
  summary: "List project pages",
  description:
    "List the wiki-like page tree of a project in sibling order. Content snapshots (yjsState, contentMarkdown) are never included here; read page content over the page WebSocket. canEdit reports whether the caller may write pages (task:update).",
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("Pages of the project", pageListSchema),
    403: errorResponse("No access to the project"),
    404: errorResponse("Project not found"),
  },
});

const createPageRoute = createRoute({
  method: "post",
  operationId: "createPage",
  path: "/",
  tags: ["Pages"],
  summary: "Create page",
  description:
    "Create a page in a project, optionally as a child of another page in the same project. Requires task:update permission.",
  middleware: [scopeToPageProject, requirePageEdit] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createPageBody } },
    },
  },
  responses: {
    200: jsonResponse("The created page", pageSchema),
    400: errorResponse("Invalid parentId"),
    403: errorResponse(
      "No access to the project, or missing task:update permission",
    ),
    404: errorResponse("Project not found"),
  },
});

const updatePageRoute = createRoute({
  method: "put",
  operationId: "updatePage",
  path: "/{id}",
  tags: ["Pages"],
  summary: "Update page",
  description:
    "Rename, move, or reorder a page. Moving a page under itself or one of its descendants is rejected. Requires task:update permission.",
  middleware: [scopeToPage, requirePageEdit] as const,
  request: {
    params: pageParam,
    body: {
      required: true,
      content: { "application/json": { schema: updatePageBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated page", pageSchema),
    400: errorResponse("Invalid parentId, or the move would create a cycle"),
    403: errorResponse(
      "No access to the project, or missing task:update permission",
    ),
    404: errorResponse("Page not found"),
  },
});

const deletePageRoute = createRoute({
  method: "delete",
  operationId: "deletePage",
  path: "/{id}",
  tags: ["Pages"],
  summary: "Delete page",
  description:
    "Delete a page and its descendants (children cascade via foreign key). Requires task:update permission.",
  middleware: [scopeToPage, requirePageEdit] as const,
  request: { params: pageParam },
  responses: {
    200: jsonResponse(
      "Deletion result",
      z.object({ success: z.boolean() }).openapi("DeletePageResult"),
    ),
    403: errorResponse(
      "No access to the project, or missing task:update permission",
    ),
    404: errorResponse("Page not found"),
  },
});

const createPageImageUploadRoute = createRoute({
  method: "put",
  operationId: "createPageImageUpload",
  path: "/{id}/image-upload",
  tags: ["Pages"],
  summary: "Create page image upload URL",
  description:
    "Get a presigned URL for uploading an image used in a page. PUT the bytes to it, then call the finalize route. Requires task:update permission.",
  middleware: [scopeToPage, requirePageEdit] as const,
  request: {
    params: pageParam,
    body: {
      required: true,
      content: { "application/json": { schema: pageImageUploadBody } },
    },
  },
  responses: {
    200: jsonResponse("The presigned upload", pageImageUploadSchema),
    400: errorResponse("Unsupported content type, or the file is too large"),
    403: errorResponse(
      "No access to the project, or missing task:update permission",
    ),
    404: errorResponse("Page not found"),
    503: errorResponse("Image uploads are not configured on this instance"),
  },
});

const finalizePageImageUploadRoute = createRoute({
  method: "post",
  operationId: "finalizePageImageUpload",
  path: "/{id}/image-upload/finalize",
  tags: ["Pages"],
  summary: "Finalize page image upload",
  description:
    "Record an uploaded page image as a private asset and return the URL to reference it by. Requires task:update permission.",
  middleware: [scopeToPage, requirePageEdit] as const,
  request: {
    params: pageParam,
    body: {
      required: true,
      content: {
        "application/json": { schema: finalizePageImageUploadBody },
      },
    },
  },
  responses: {
    200: jsonResponse("The stored asset", finalizedPageAssetSchema),
    400: errorResponse(
      "Invalid upload, or the key does not belong to this page",
    ),
    403: errorResponse(
      "No access to the project, or missing task:update permission",
    ),
    404: errorResponse("Page not found"),
  },
});

const page = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listProjectPagesRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const { pages, workspaceId } = await listPages(projectId, c.get("userId"));
    const canEdit = await hasWorkspacePermission(
      c,
      { task: ["update"] },
      workspaceId,
    );
    return c.json({ pages, canEdit }, 200);
  })
  .openapi(createPageRoute, async (c) => {
    const body = c.req.valid("json");
    return c.json(await createPage(c.get("userId"), body), 200);
  })
  .openapi(updatePageRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    return c.json(await updatePage(c.get("userId"), id, body), 200);
  })
  .openapi(deletePageRoute, async (c) => {
    const { id } = c.req.valid("param");
    return c.json(await deletePage(c.get("userId"), id), 200);
  })
  .openapi(createPageImageUploadRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    return c.json(await createPageImageUpload(id, body), 200);
  })
  .openapi(finalizePageImageUploadRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const apiBaseUrl = normalizeApiServerUrl(
      process.env.KANEO_API_URL || new URL(c.req.url).origin,
    );
    return c.json(
      await finalizePageImageUpload(c.get("userId"), id, body, apiBaseUrl),
      200,
    );
  });

export default page;
