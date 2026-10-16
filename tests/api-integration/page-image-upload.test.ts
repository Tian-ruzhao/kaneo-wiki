import { randomUUID } from "node:crypto";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { S3Client } from "../../apps/api/node_modules/@aws-sdk/client-s3";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import { readErrorBody } from "./helpers/error-body";

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

async function createPageFixture(projectId: string, userId: string) {
  const [page] = await db
    .insert(schema.pageTable)
    .values({ projectId, title: "Test page", createdBy: userId })
    .returning();
  return page;
}

describe("API integration: page image upload", () => {
  beforeEach(async () => {
    await resetTestDatabase();

    process.env.S3_ENDPOINT = "https://storage.example.test";
    process.env.S3_BUCKET = "test-bucket";
    process.env.S3_ACCESS_KEY_ID = "test-access-key";
    process.env.S3_SECRET_ACCESS_KEY = "test-secret-key";
    delete process.env.S3_KEY_PREFIX;
    vi.spyOn(S3Client.prototype, "send").mockRejectedValue(
      new Error("No uploaded-object fixture configured"),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lets an editor presign an upload scoped to the page", async () => {
    process.env.KANEO_API_URL = "http://localhost:1337";

    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const page = await createPageFixture(project.id, member.user.id);

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(`/api/page/${page.id}/image-upload`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: "diagram.png",
        contentType: "image/png",
        size: 12345,
      }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      key: string;
      uploadUrl: string;
      headers: Record<string, string>;
    };
    expect(payload.key).toContain(
      `project/${project.id}/page/${page.id}/images/`,
    );
    expect(payload.uploadUrl).toContain("test-bucket");
    expect(payload.headers["Content-Type"]).toBe("image/png");
  });

  it("lets an editor finalize an upload and returns an asset url", async () => {
    vi.mocked(S3Client.prototype.send).mockResolvedValueOnce({
      ContentLength: 12345,
      ContentType: "image/png",
    });
    process.env.KANEO_API_URL = "http://localhost:1337";

    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const page = await createPageFixture(project.id, member.user.id);

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const key = `workspace/${member.workspace.id}/project/${project.id}/page/${page.id}/images/diagram-123.png`;

    const response = await app.request(
      `/api/page/${page.id}/image-upload/finalize`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key,
          filename: "diagram.png",
          contentType: "image/png",
          size: 12345,
        }),
      },
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { id: string; url: string };
    expect(payload).toHaveProperty("id");
    expect(payload.url).toBe(`http://localhost:1337/api/asset/${payload.id}`);

    const asset = await db.query.assetTable.findFirst({
      where: (t, { eq }) => eq(t.id, payload.id),
    });
    expect(asset).toBeDefined();
    expect(asset?.objectKey).toBe(key);
    expect(asset?.filename).toBe("diagram.png");
    expect(asset?.mimeType).toBe("image/png");
    expect(asset?.size).toBe(12345);
    expect(asset?.kind).toBe("image");
    expect(asset?.surface).toBe("description");
    expect(asset?.workspaceId).toBe(member.workspace.id);
    expect(asset?.projectId).toBe(project.id);
    expect(asset?.pageId).toBe(page.id);
    expect(asset?.taskId).toBeNull();
    expect(asset?.createdBy).toBe(member.user.id);
  });

  it("rejects viewer presign and finalize requests with 403", async () => {
    process.env.KANEO_API_URL = "http://localhost:1337";

    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const page = await createPageFixture(project.id, member.user.id);
    const viewer = await createWorkspaceViewer(member.workspace.id);

    mockAuthenticatedSession(viewer);
    const { app } = createApp();

    const presign = await app.request(`/api/page/${page.id}/image-upload`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: "diagram.png",
        contentType: "image/png",
        size: 100,
      }),
    });
    expect(presign.status).toBe(403);

    const finalize = await app.request(
      `/api/page/${page.id}/image-upload/finalize`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: `workspace/${member.workspace.id}/project/${project.id}/page/${page.id}/images/diagram-123.png`,
          filename: "diagram.png",
          contentType: "image/png",
          size: 100,
        }),
      },
    );
    expect(finalize.status).toBe(403);
  });

  it("returns 404 for a page in a foreign project", async () => {
    process.env.KANEO_API_URL = "http://localhost:1337";

    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const page = await createPageFixture(project.id, member.user.id);

    const outsider = await createWorkspaceMember();
    mockAuthenticatedSession(outsider.user);
    const { app } = createApp();

    const response = await app.request(`/api/page/${page.id}/image-upload`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: "diagram.png",
        contentType: "image/png",
        size: 100,
      }),
    });

    expect(response.status).toBe(404);
  });

  it("rejects a key scoped to a different page", async () => {
    process.env.KANEO_API_URL = "http://localhost:1337";

    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const page = await createPageFixture(project.id, member.user.id);
    const otherPage = await createPageFixture(project.id, member.user.id);

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/page/${page.id}/image-upload/finalize`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: `workspace/${member.workspace.id}/project/${project.id}/page/${otherPage.id}/images/other-123.png`,
          filename: "other.png",
          contentType: "image/png",
          size: 100,
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(await readErrorBody(response)).toMatchObject({
      message: "Image upload key does not match the page context.",
      code: "BAD_REQUEST",
    });
  });

  it("returns 503 when storage is not configured", async () => {
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_BUCKET;

    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const page = await createPageFixture(project.id, member.user.id);

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(`/api/page/${page.id}/image-upload`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: "diagram.png",
        contentType: "image/png",
        size: 100,
      }),
    });

    expect(response.status).toBe(503);
  });
});
