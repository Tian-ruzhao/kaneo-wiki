import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import { readErrorBody } from "./helpers/error-body";

type PageBody = {
  projectId: string;
  parentId?: string | null;
  title?: string;
};

async function createPageViaApi(
  app: ReturnType<typeof createApp>["app"],
  body: PageBody,
) {
  const response = await app.request("/api/page", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response;
}

async function createWorkspaceViewer(workspaceId: string) {
  const viewerId = `user-viewer-${randomUUID()}`;
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id: viewerId,
      email: `${viewerId}@example.com`,
      emailVerified: true,
      name: "Page Viewer",
    })
    .returning();
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: user.id,
    role: "viewer",
    joinedAt: new Date(),
  });
  return user;
}

describe("API integration: pages", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("rejects unauthenticated page listing", async () => {
    mockAnonymousSession();
    const { app } = createApp();

    const response = await app.request("/api/page/project/missing", {
      method: "GET",
    });

    expect(response.status).toBe(401);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Unauthorized",
      code: "UNAUTHORIZED",
    });
  });

  it("lists pages without content snapshots", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const created = await createPageViaApi(app, {
      projectId: project.id,
      title: "Root",
    });
    expect(created.status).toBe(200);
    const root = (await created.json()) as { id: string };

    const child = await createPageViaApi(app, {
      projectId: project.id,
      parentId: root.id,
      title: "Child",
    });
    expect(child.status).toBe(200);

    const response = await app.request(`/api/page/project/${project.id}`, {
      method: "GET",
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      pages: Array<Record<string, unknown>>;
    };
    expect(payload.pages).toHaveLength(2);
    for (const page of payload.pages) {
      expect(page).not.toHaveProperty("yjsState");
      expect(page).not.toHaveProperty("contentMarkdown");
      expect(page).toMatchObject({ projectId: project.id });
    }
    const titles = payload.pages.map((page) => page["title"]).sort();
    expect(titles).toEqual(["Child", "Root"]);
  });

  it("creates a page with a default title", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await createPageViaApi(app, { projectId: project.id });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      id: string;
      title: string;
      parentId: string | null;
      position: number;
    };
    expect(payload).toMatchObject({
      projectId: project.id,
      title: "",
      parentId: null,
      position: 0,
    });

    const persisted = await db.query.pageTable.findFirst({
      where: eq(schema.pageTable.id, payload.id),
    });
    expect(persisted).toMatchObject({
      id: payload.id,
      createdBy: member.user.id,
    });
  });

  it("rejects a parent from another project", async () => {
    const member = await createWorkspaceMember();
    const { project: projectA } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const { project: projectB } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const other = await createPageViaApi(app, {
      projectId: projectB.id,
      title: "Other",
    });
    const otherPage = (await other.json()) as { id: string };

    const response = await createPageViaApi(app, {
      projectId: projectA.id,
      parentId: otherPage.id,
      title: "Cross",
    });
    expect(response.status).toBe(400);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Invalid parentId",
    });
  });

  it("updates title and position", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const created = await createPageViaApi(app, {
      projectId: project.id,
      title: "Before",
    });
    const page = (await created.json()) as { id: string };

    const response = await app.request(`/api/page/${page.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "After", position: 3 }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: page.id,
      title: "After",
      position: 3,
    });
  });

  it("rejects moving a page under itself or its descendants", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const rootRes = await createPageViaApi(app, {
      projectId: project.id,
      title: "Root",
    });
    const root = (await rootRes.json()) as { id: string };
    const childRes = await createPageViaApi(app, {
      projectId: project.id,
      parentId: root.id,
      title: "Child",
    });
    const child = (await childRes.json()) as { id: string };

    const selfMove = await app.request(`/api/page/${root.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentId: root.id }),
    });
    expect(selfMove.status).toBe(400);

    const cycleMove = await app.request(`/api/page/${root.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentId: child.id }),
    });
    expect(cycleMove.status).toBe(400);
    expect(await readErrorBody(cycleMove)).toMatchObject({
      message: "A page cannot be moved under its own descendant",
    });
  });

  it("rejects moving a page to a parent in another project", async () => {
    const member = await createWorkspaceMember();
    const { project: projectA } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const { project: projectB } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const pageRes = await createPageViaApi(app, {
      projectId: projectA.id,
      title: "Page",
    });
    const page = (await pageRes.json()) as { id: string };
    const otherRes = await createPageViaApi(app, {
      projectId: projectB.id,
      title: "Other",
    });
    const other = (await otherRes.json()) as { id: string };

    const response = await app.request(`/api/page/${page.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentId: other.id }),
    });
    expect(response.status).toBe(400);
  });

  it("returns 404 to users without project access", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const created = await createPageViaApi(app, {
      projectId: project.id,
      title: "Secret",
    });
    const page = (await created.json()) as { id: string };

    const outsiderId = "user-page-outsider";
    const [outsider] = await db
      .insert(schema.userTable)
      .values({
        id: outsiderId,
        email: `${outsiderId}@example.com`,
        emailVerified: true,
        name: "Page Outsider",
      })
      .returning();
    mockAuthenticatedSession(outsider);

    const listed = await app.request(`/api/page/project/${project.id}`, {
      method: "GET",
    });
    expect(listed.status).toBe(404);

    const updated = await app.request(`/api/page/${page.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Hacked" }),
    });
    expect(updated.status).toBe(404);

    const deleted = await app.request(`/api/page/${page.id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(404);

    // The page is untouched.
    const persisted = await db.query.pageTable.findFirst({
      where: eq(schema.pageTable.id, page.id),
    });
    expect(persisted?.title).toBe("Secret");
  });

  it("deletes children with their parent", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const rootRes = await createPageViaApi(app, {
      projectId: project.id,
      title: "Root",
    });
    const root = (await rootRes.json()) as { id: string };
    const childRes = await createPageViaApi(app, {
      projectId: project.id,
      parentId: root.id,
      title: "Child",
    });
    const child = (await childRes.json()) as { id: string };
    const grandchildRes = await createPageViaApi(app, {
      projectId: project.id,
      parentId: child.id,
      title: "Grandchild",
    });
    const grandchild = (await grandchildRes.json()) as { id: string };

    const response = await app.request(`/api/page/${root.id}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });

    for (const id of [root.id, child.id, grandchild.id]) {
      const persisted = await db.query.pageTable.findFirst({
        where: eq(schema.pageTable.id, id),
      });
      expect(persisted).toBeUndefined();
    }
  });

  it("returns 404 when deleting a missing page", async () => {
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request("/api/page/page-missing", {
      method: "DELETE",
    });
    expect(response.status).toBe(404);
  });

  describe("viewer permissions", () => {
    it("reports canEdit false for viewers and true for members", async () => {
      const member = await createWorkspaceMember();
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const viewer = await createWorkspaceViewer(member.workspace.id);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      await createPageViaApi(app, { projectId: project.id, title: "Root" });

      mockAuthenticatedSession(viewer);
      const asViewer = await app.request(`/api/page/project/${project.id}`, {
        method: "GET",
      });
      expect(asViewer.status).toBe(200);
      const viewerPayload = (await asViewer.json()) as {
        pages: unknown[];
        canEdit: boolean;
      };
      expect(viewerPayload.pages).toHaveLength(1);
      expect(viewerPayload.canEdit).toBe(false);

      mockAuthenticatedSession(member.user);
      const asMember = await app.request(`/api/page/project/${project.id}`, {
        method: "GET",
      });
      expect(asMember.status).toBe(200);
      expect((await asMember.json()) as { canEdit: boolean }).toMatchObject({
        canEdit: true,
      });
    });

    it("denies viewer page creation with 403", async () => {
      const member = await createWorkspaceMember();
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const viewer = await createWorkspaceViewer(member.workspace.id);
      mockAuthenticatedSession(viewer);
      const { app } = createApp();

      const response = await createPageViaApi(app, {
        projectId: project.id,
        title: "Viewer page",
      });
      expect(response.status).toBe(403);
      expect(await readErrorBody(response)).toMatchObject({
        message: "Insufficient permissions",
        code: "MISSING_PERMISSION",
      });

      const persisted = await db.query.pageTable.findMany({
        where: eq(schema.pageTable.projectId, project.id),
      });
      expect(persisted).toHaveLength(0);
    });

    it("denies viewer page updates with 403", async () => {
      const member = await createWorkspaceMember();
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const viewer = await createWorkspaceViewer(member.workspace.id);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const created = await createPageViaApi(app, {
        projectId: project.id,
        title: "Before",
      });
      const page = (await created.json()) as { id: string };

      mockAuthenticatedSession(viewer);
      const response = await app.request(`/api/page/${page.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Hacked" }),
      });
      expect(response.status).toBe(403);
      expect(await readErrorBody(response)).toMatchObject({
        code: "MISSING_PERMISSION",
      });

      const persisted = await db.query.pageTable.findFirst({
        where: eq(schema.pageTable.id, page.id),
      });
      expect(persisted?.title).toBe("Before");
    });

    it("denies viewer page deletion with 403", async () => {
      const member = await createWorkspaceMember();
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const viewer = await createWorkspaceViewer(member.workspace.id);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const created = await createPageViaApi(app, {
        projectId: project.id,
        title: "Keep me",
      });
      const page = (await created.json()) as { id: string };

      mockAuthenticatedSession(viewer);
      const response = await app.request(`/api/page/${page.id}`, {
        method: "DELETE",
      });
      expect(response.status).toBe(403);

      const persisted = await db.query.pageTable.findFirst({
        where: eq(schema.pageTable.id, page.id),
      });
      expect(persisted?.title).toBe("Keep me");
    });
  });
});
