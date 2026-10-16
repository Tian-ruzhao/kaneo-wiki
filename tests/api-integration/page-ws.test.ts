import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { serve } from "../../apps/api/node_modules/@hono/node-server";
import type { NodeWebSocket } from "../../apps/api/node_modules/@hono/node-ws";
import { auth } from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { hasPageRoom } from "../../apps/api/src/page/room";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// Test-only Yjs client, resolved from the API package without adding a
// production dependency to the test workspace.
type Socket = NodeWebSocket["wss"]["clients"] extends Set<infer S> ? S : never;
const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const nodeWsRequire = createRequire(apiRequire.resolve("@hono/node-ws"));
const WebSocket: new (
  url: string,
  options: { headers: Record<string, string> },
) => Socket = nodeWsRequire("ws").WebSocket;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Y = apiRequire("yjs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const syncProtocol = apiRequire("y-protocols/sync");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const encoding = apiRequire("lib0/encoding");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const decoding = apiRequire("lib0/decoding");

let server: ReturnType<typeof serve>;
let baseUrl: string;
const sockets: Socket[] = [];
let member: Awaited<ReturnType<typeof createWorkspaceMember>>;

const headers = {
  cookie: "test-session=valid",
  origin: "http://localhost:5173",
};

async function connect(
  path: string,
  connectHeaders: Record<string, string>,
  options?: {
    // Runs the full y-protocols sync handshake for `doc` so both sides
    // converge. Attached synchronously at construction: the server sends
    // SyncStep1 in the same tick as the 101 upgrade, so listeners added
    // after `open` can miss it.
    doc?: typeof Y.Doc;
    onBinary?: (bytes: Uint8Array) => void;
  },
) {
  const socket = new WebSocket(`${baseUrl}/api/ws/${path}`, {
    headers: connectHeaders,
  });
  sockets.push(socket);
  socket.on("error", () => {});
  socket.on("message", (data: unknown) => {
    const bytes = toBytes(data);
    if (!bytes) return;
    options?.onBinary?.(bytes);
    const doc = options?.doc;
    if (!doc) return;
    try {
      const decoder = decoding.createDecoder(bytes);
      if (decoding.readVarUint(decoder) !== 0) return;
      const encoder = encoding.createEncoder();
      // The reply keeps the outer envelope so the server can feed the whole
      // frame back into the sync protocol.
      encoding.writeVarUint(encoder, 0);
      syncProtocol.readSyncMessage(decoder, encoder, doc, null);
      if (encoding.length(encoder) > 1) {
        socket.send(Buffer.from(encoding.toUint8Array(encoder)));
      }
    } catch {
      // Malformed frames are a server bug in this test harness.
    }
  });
  const status = await new Promise<number>((resolve) => {
    socket.once("open", () => resolve(101));
    socket.once(
      "unexpected-response",
      (_request: unknown, response: IncomingMessage) => {
        response.resume();
        resolve(response.statusCode ?? 0);
        socket.terminate();
      },
    );
  });
  return { socket, status };
}

function toBytes(data: unknown): Uint8Array | null {
  if (typeof data === "string") return null;
  if (Buffer.isBuffer(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return null;
}

async function waitForBinary(
  take: () => Uint8Array | undefined,
): Promise<Uint8Array> {
  let found: Uint8Array | undefined;
  await waitFor(() => {
    found = take();
    return found !== undefined;
  });
  return found as Uint8Array;
}

function sendDocUpdate(socket: Socket, doc: typeof Y.Doc) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0);
  syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(doc));
  socket.send(Buffer.from(encoding.toUint8Array(encoder)));
}

// Real Yjs clients open with their own SyncStep1 so the server replies with
// the updates they are missing (this is how late joiners catch up).
function sendSyncStep1(socket: Socket, doc: typeof Y.Doc) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0);
  syncProtocol.writeSyncStep1(encoder, doc);
  socket.send(Buffer.from(encoding.toUint8Array(encoder)));
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await condition()) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

beforeEach(async () => {
  await resetTestDatabase();
  member = await createWorkspaceMember();
  const sessionMock = mockAuthenticatedSession(member.user);
  const session = await auth.api.getSession({ headers: new Headers() });
  sessionMock.mockImplementation(async ({ headers: requestHeaders }) => {
    const h = new Headers(requestHeaders);
    if (h.get("authorization") === "Bearer valid-test-session") {
      return session;
    }
    // The shared member session answers "test-session=valid"; any other
    // cookie token is treated as a user id so tests can connect as
    // additional workspace members (e.g. viewers).
    const token = h
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("test-session="))
      ?.slice("test-session=".length);
    if (token === "valid") return session;
    if (!token) return null;
    const user = await db.query.userTable.findFirst({
      where: eq(schema.userTable.id, token),
    });
    if (!user) return null;
    const now = new Date();
    return {
      session: {
        id: `session-${user.id}`,
        token: `token-${user.id}`,
        userId: user.id,
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
        createdAt: now,
        updatedAt: now,
        ipAddress: null,
        userAgent: null,
      },
      user,
    };
  });
  const created = createApp();
  server = serve({ fetch: created.app.fetch, hostname: "127.0.0.1", port: 0 });
  created.injectWebSocket(server);
  if (!server.listening) await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  baseUrl = `ws://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  vi.unstubAllEnvs();
});

async function seedPage() {
  const { project } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  const [page] = await db
    .insert(schema.pageTable)
    .values({
      projectId: project.id,
      title: "Wiki",
      createdBy: member.user.id,
    })
    .returning();
  return { member, project, page };
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

describe("API integration: page WebSocket", () => {
  it("rejects unauthenticated connections", async () => {
    const { page } = await seedPage();
    expect(
      (await connect(`page/${page.id}`, { origin: headers.origin })).status,
    ).toBe(401);
  });

  it("rejects pages in foreign projects and missing pages with 404", async () => {
    const foreign = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: foreign.workspace.id,
    });
    const [foreignPage] = await db
      .insert(schema.pageTable)
      .values({ projectId: project.id, title: "Foreign" })
      .returning();
    expect((await connect(`page/${foreignPage.id}`, headers)).status).toBe(404);
    expect((await connect("page/page-missing", headers)).status).toBe(404);
  });

  it("sends SyncStep1 on connect and keeps text pings working", async () => {
    const { page } = await seedPage();
    const binaries: Uint8Array[] = [];
    const { socket, status } = await connect(`page/${page.id}`, headers, {
      onBinary: (bytes) => binaries.push(bytes),
    });
    expect(status).toBe(101);

    const first = await waitForBinary(() => binaries[0]);
    const decoder = decoding.createDecoder(first);
    expect(decoding.readVarUint(decoder)).toBe(0); // messageSync
    expect(decoding.readVarUint(decoder)).toBe(0); // SyncStep1

    socket.send('{"type":"ping"}');
    const pong = once(socket, "pong");
    socket.ping("test");
    await pong;
    expect(socket.readyState).toBe(1);
  });

  it("closes invalid binary messages with 1008", async () => {
    const { page } = await seedPage();
    const binaries: Uint8Array[] = [];
    const { socket, status } = await connect(`page/${page.id}`, headers, {
      onBinary: (bytes) => binaries.push(bytes),
    });
    expect(status).toBe(101);
    await waitForBinary(() => binaries[0]);
    const closed = once(socket, "close");
    socket.send(Buffer.from([0xff, 0x00]));
    expect((await closed)[0]).toBe(1008);
  });

  it("relays an update from A to B, syncs late joiners, and persists", async () => {
    // Short debounce so the test does not wait the ~2s production default.
    vi.stubEnv("PAGE_WS_SAVE_DEBOUNCE_MS", "50");
    const { page } = await seedPage();

    const docA = new Y.Doc();
    const { socket: socketA, status: statusA } = await connect(
      `page/${page.id}`,
      headers,
      { doc: docA },
    );
    expect(statusA).toBe(101);
    sendSyncStep1(socketA, docA);

    const docB = new Y.Doc();
    const { socket: socketB, status: statusB } = await connect(
      `page/${page.id}`,
      headers,
      { doc: docB },
    );
    expect(statusB).toBe(101);
    sendSyncStep1(socketB, docB);

    docA.getText("content").insert(0, "hello pages");
    sendDocUpdate(socketA, docA);

    await waitFor(() => docB.getText("content").toString() === "hello pages");

    // A late joiner converges through the SyncStep1/Step2 handshake alone.
    const docC = new Y.Doc();
    const { socket: socketC, status: statusC } = await connect(
      `page/${page.id}`,
      headers,
      { doc: docC },
    );
    expect(statusC).toBe(101);
    sendSyncStep1(socketC, docC);
    await waitFor(() => docC.getText("content").toString() === "hello pages");

    for (const socket of [socketA, socketB, socketC]) socket.close();
    await waitFor(async () => {
      const [row] = await db
        .select({
          yjsState: schema.pageTable.yjsState,
          contentMarkdown: schema.pageTable.contentMarkdown,
        })
        .from(schema.pageTable)
        .where(eq(schema.pageTable.id, page.id))
        .limit(1);
      return (
        !!row?.yjsState &&
        row.yjsState.length > 0 &&
        row.contentMarkdown === "hello pages" &&
        !hasPageRoom(page.id)
      );
    });
  });

  it("records the editing user as updated_by after the debounce", async () => {
    vi.stubEnv("PAGE_WS_SAVE_DEBOUNCE_MS", "50");
    const { page } = await seedPage();

    const doc = new Y.Doc();
    const { socket, status } = await connect(`page/${page.id}`, headers, {
      doc,
    });
    expect(status).toBe(101);
    sendSyncStep1(socket, doc);

    doc.getText("content").insert(0, "edited content");
    sendDocUpdate(socket, doc);

    await waitFor(async () => {
      const [row] = await db
        .select({ updatedBy: schema.pageTable.updatedBy })
        .from(schema.pageTable)
        .where(eq(schema.pageTable.id, page.id))
        .limit(1);
      return row?.updatedBy === member.user.id;
    });

    socket.close();
    await waitFor(() => !hasPageRoom(page.id));
  });

  it("leaves updated_by untouched for read-only viewer updates", async () => {
    vi.stubEnv("PAGE_WS_SAVE_DEBOUNCE_MS", "50");
    const { page } = await seedPage();
    const viewer = await createWorkspaceViewer(member.workspace.id);
    const viewerHeaders = {
      cookie: `test-session=${viewer.id}`,
      origin: headers.origin,
    };

    const docViewer = new Y.Doc();
    const { socket, status } = await connect(`page/${page.id}`, viewerHeaders, {
      doc: docViewer,
    });
    expect(status).toBe(101);
    sendSyncStep1(socket, docViewer);

    docViewer.getText("content").insert(0, "viewer text");
    sendDocUpdate(socket, docViewer);

    // Wait past the debounce so a buggy write would have landed.
    await new Promise((resolve) => setTimeout(resolve, 400));
    const [row] = await db
      .select({ updatedBy: schema.pageTable.updatedBy })
      .from(schema.pageTable)
      .where(eq(schema.pageTable.id, page.id))
      .limit(1);
    expect(row?.updatedBy).toBeNull();

    socket.close();
    await waitFor(() => !hasPageRoom(page.id));
  });

  it("drops updates from read-only sockets while still sending them state", async () => {
    vi.stubEnv("PAGE_WS_SAVE_DEBOUNCE_MS", "50");
    const { page } = await seedPage();
    const viewer = await createWorkspaceViewer(member.workspace.id);
    const viewerHeaders = {
      cookie: `test-session=${viewer.id}`,
      origin: headers.origin,
    };

    const docEditor = new Y.Doc();
    const { socket: socketEditor, status: editorStatus } = await connect(
      `page/${page.id}`,
      headers,
      { doc: docEditor },
    );
    expect(editorStatus).toBe(101);
    sendSyncStep1(socketEditor, docEditor);

    // Viewers may still connect and watch.
    const docViewer = new Y.Doc();
    const { socket: socketViewer, status: viewerStatus } = await connect(
      `page/${page.id}`,
      viewerHeaders,
      { doc: docViewer },
    );
    expect(viewerStatus).toBe(101);
    sendSyncStep1(socketViewer, docViewer);

    docViewer.getText("content").insert(0, "viewer text");
    sendDocUpdate(socketViewer, docViewer);

    docEditor.getText("content").insert(0, "editor text");
    sendDocUpdate(socketEditor, docEditor);

    // The viewer receives the editor's state...
    await waitFor(() =>
      docViewer.getText("content").toString().includes("editor text"),
    );
    // ...but the editor never sees the dropped viewer update.
    expect(docEditor.getText("content").toString()).toBe("editor text");

    for (const socket of [socketEditor, socketViewer]) socket.close();
    await waitFor(async () => {
      const [row] = await db
        .select({
          yjsState: schema.pageTable.yjsState,
          contentMarkdown: schema.pageTable.contentMarkdown,
        })
        .from(schema.pageTable)
        .where(eq(schema.pageTable.id, page.id))
        .limit(1);
      return (
        !!row?.yjsState &&
        row.yjsState.length > 0 &&
        row.contentMarkdown === "editor text" &&
        !hasPageRoom(page.id)
      );
    });
  });
});
