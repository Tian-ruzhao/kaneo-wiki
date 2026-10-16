import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { WSContext } from "hono/ws";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import db from "../database";
import { pageTable, projectTable } from "../database/schema";
import { assertProjectAccess } from "../project-access/assert-project-access";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { getRedisPub, getRedisSub, isRedisConfigured } from "../redis";

/**
 * Real-time collaborative page rooms.
 *
 * Each open page holds one in-memory Y.Doc shared by every client currently
 * viewing that page. Sync traffic follows the y-protocols wire format on
 * binary WebSocket frames (messageSync = 0); awareness/presence traffic
 * (messageAwareness = 1) is relayed verbatim and never persisted.
 *
 * Multi-instance delivery is best-effort through Redis pub/sub on
 * `kaneo:page:{pageId}:yjs`. Redis stays optional: a single instance works
 * with no Redis configured.
 */

export const PAGE_WS_MAX_BYTES = 1024 * 1024; // 1 MB per binary frame

const messageSync = 0;
const messageAwareness = 1;

// Origin marker for updates arriving through the Redis relay, so the update
// listener relays them to local clients without republishing them.
const REDIS_RELAY_ORIGIN = Symbol("kaneo:page-redis-relay");

const PAGE_RELAY_CHANNEL_PREFIX = "kaneo:page:";
const PAGE_RELAY_CHANNEL_SUFFIX = ":yjs";
const PAGE_RELAY_PATTERN = `${PAGE_RELAY_CHANNEL_PREFIX}*${PAGE_RELAY_CHANNEL_SUFFIX}`;

function pageRelayChannel(pageId: string) {
  return `${PAGE_RELAY_CHANNEL_PREFIX}${pageId}${PAGE_RELAY_CHANNEL_SUFFIX}`;
}

function pageIdFromRelayChannel(channel: string): string | null {
  if (
    !channel.startsWith(PAGE_RELAY_CHANNEL_PREFIX) ||
    !channel.endsWith(PAGE_RELAY_CHANNEL_SUFFIX)
  ) {
    return null;
  }
  const pageId = channel.slice(
    PAGE_RELAY_CHANNEL_PREFIX.length,
    channel.length - PAGE_RELAY_CHANNEL_SUFFIX.length,
  );
  return pageId || null;
}

export type PageClient = {
  ws: WSContext;
  // Whether the socket's user holds task:update in the page's workspace.
  // Read-only sockets receive sync state and awareness but their document
  // changes are dropped (see handleBinaryBytes).
  canEdit: boolean;
  // Authenticated user behind this socket; recorded as updated_by when an
  // edit from this client changes the document.
  userId: string;
};

function readInnerSyncType(bytes: Uint8Array): number | null {
  try {
    const probe = decoding.createDecoder(bytes);
    if (decoding.readVarUint(probe) !== messageSync) return null;
    return decoding.readVarUint(probe);
  } catch {
    return null;
  }
}

function toSendableBytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  // hono's WSContext.send only accepts ArrayBuffer-backed views.
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy;
}

type PageRoom = {
  pageId: string;
  doc: Y.Doc;
  clients: Set<PageClient>;
  saveTimer: ReturnType<typeof setTimeout> | null;
  // User behind the most recent document change from an editing client.
  // Persisted as page.updated_by alongside yjs_state.
  lastEditorUserId: string | null;
};

const rooms = new Map<string, PageRoom>();
const pendingLoads = new Map<string, Promise<PageRoom>>();

function getSaveDebounceMs(): number {
  const raw = process.env.PAGE_WS_SAVE_DEBOUNCE_MS;
  const parsed = raw !== undefined ? Number(raw) : Number.NaN;
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return 2000;
}

function stripXmlTags(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

function collectItemText(item: Y.Item, out: string[]): void {
  const content = item.content;
  if (content instanceof Y.ContentString) {
    out.push(content.str);
  } else if (content instanceof Y.ContentAny) {
    for (const value of content.arr) {
      if (typeof value === "string" && value) out.push(value);
    }
  } else if (content instanceof Y.ContentType) {
    collectTypeText(content.type, out);
  }
  // ContentFormat (bold/italic markers), ContentEmbed, ContentDeleted,
  // ContentBinary, ContentJSON and friends carry no plain text.
}

function collectTypeText(type: Y.AbstractType<any>, out: string[]): void {
  // Walk the type's item linked list in document order. `_start`/`right`
  // are yjs internals, but they are the only way to read text from roots
  // the server never defined locally: such roots materialize as plain
  // AbstractType after applying a remote update, so instanceof checks and
  // toString() cannot see their content.
  let item = (type as unknown as { _start?: Y.Item | null })._start ?? null;
  const seen = new Set<Y.Item>();
  while (item !== null && !seen.has(item)) {
    seen.add(item);
    if (!item.deleted) collectItemText(item, out);
    item = item.right;
  }
}

/**
 * Derive a plain-text snapshot for search/export from the shared document.
 * Roots the server never defined locally still contribute their text via an
 * item-level walk, so any yjs client structure degrades to its readable
 * text rather than "[object Object]". Formatting, embeds, and non-string
 * values are dropped.
 */
export function derivePlainText(doc: Y.Doc): string {
  const parts: string[] = [];
  doc.share.forEach((type) => {
    try {
      const out: string[] = [];
      collectTypeText(type, out);
      const text = stripXmlTags(out.join("")).trim();
      if (text) parts.push(text);
    } catch {
      // Ignore roots that cannot be read.
    }
  });
  return parts.join("\n").slice(0, 1_000_000);
}

async function persistRoom(room: PageRoom): Promise<void> {
  const state = Y.encodeStateAsUpdate(room.doc);
  const plainText = derivePlainText(room.doc);
  try {
    await db
      .update(pageTable)
      .set({
        yjsState: Buffer.from(state),
        contentMarkdown: plainText || null,
        updatedAt: new Date(),
        ...(room.lastEditorUserId !== null
          ? { updatedBy: room.lastEditorUserId }
          : {}),
      })
      .where(eq(pageTable.id, room.pageId));
  } catch (error) {
    console.error(`Failed to persist page ${room.pageId}:`, error);
  }
}

function schedulePageSave(room: PageRoom): void {
  if (room.saveTimer) clearTimeout(room.saveTimer);
  const timer = setTimeout(() => {
    room.saveTimer = null;
    void persistRoom(room);
  }, getSaveDebounceMs());
  // Never hold the process open for an idle room; the last-leave path
  // persists synchronously instead.
  if (typeof (timer as unknown as { unref?: unknown }).unref === "function") {
    (timer as unknown as { unref: () => void }).unref();
  }
  room.saveTimer = timer;
}

function publishPageUpdate(pageId: string, update: Uint8Array): void {
  if (!isRedisConfigured()) return;
  try {
    const payload = Buffer.from(update).toString("base64");
    void getRedisPub()
      .publish(pageRelayChannel(pageId), payload)
      .catch((error: unknown) => {
        console.error(`Failed to relay page ${pageId} update:`, error);
      });
  } catch (error) {
    console.error(`Failed to relay page ${pageId} update:`, error);
  }
}

let pageRelaySubscribed = false;

function ensurePageRedisRelay(): void {
  if (pageRelaySubscribed || !isRedisConfigured()) return;
  pageRelaySubscribed = true;
  try {
    const sub = getRedisSub() as unknown as {
      psubscribe(pattern: string): Promise<unknown>;
      on(event: string, handler: (...args: never[]) => void): void;
    };
    sub.on("pmessage", ((pattern: string, channel: string, data: string) => {
      if (pattern !== PAGE_RELAY_PATTERN) return;
      const pageId = pageIdFromRelayChannel(channel);
      if (!pageId) return;
      const room = rooms.get(pageId);
      // Only instances with local clients need the update.
      if (!room) return;
      try {
        const update = new Uint8Array(Buffer.from(data, "base64"));
        Y.applyUpdate(room.doc, update, REDIS_RELAY_ORIGIN);
      } catch (error) {
        console.error(`Failed to apply relayed page ${pageId} update:`, error);
      }
    }) as (...args: never[]) => void);
    void sub.psubscribe(PAGE_RELAY_PATTERN).catch((error: unknown) => {
      console.error("Failed to subscribe to page relay channels:", error);
    });
  } catch (error) {
    console.error("Failed to initialize page relay subscription:", error);
  }
}

async function loadRoom(pageId: string): Promise<PageRoom> {
  const [row] = await db
    .select({ yjsState: pageTable.yjsState })
    .from(pageTable)
    .where(eq(pageTable.id, pageId))
    .limit(1);

  if (!row) {
    throw new HTTPException(404, { message: "Page not found" });
  }

  const doc = new Y.Doc();
  if (row.yjsState && row.yjsState.length > 0) {
    try {
      Y.applyUpdate(doc, new Uint8Array(row.yjsState));
    } catch (error) {
      console.error(
        `Failed to load persisted state for page ${pageId}:`,
        error,
      );
    }
  }

  const room: PageRoom = {
    pageId,
    doc,
    clients: new Set(),
    saveTimer: null,
    lastEditorUserId: null,
  };

  doc.on("update", (update: Uint8Array, origin: unknown) => {
    // Attribute document changes to the editing client that produced them.
    // Read-only clients never reach here (their updates are dropped before
    // touching the doc) and the Redis relay origin carries no user.
    if (
      typeof origin === "object" &&
      origin !== null &&
      "canEdit" in origin &&
      "userId" in origin &&
      (origin as PageClient).canEdit === true &&
      typeof (origin as PageClient).userId === "string"
    ) {
      room.lastEditorUserId = (origin as PageClient).userId;
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, update);
    const message = toSendableBytes(encoding.toUint8Array(encoder));
    for (const other of room.clients) {
      if (other === origin) continue;
      try {
        other.ws.send(message);
      } catch {
        // Dead sockets are reaped on close.
      }
    }
    if (origin !== REDIS_RELAY_ORIGIN) {
      publishPageUpdate(room.pageId, update);
    }
    schedulePageSave(room);
  });

  rooms.set(pageId, room);
  return room;
}

export function getOrLoadRoom(pageId: string): Promise<PageRoom> {
  const existing = rooms.get(pageId);
  if (existing) return Promise.resolve(existing);
  let pending = pendingLoads.get(pageId);
  if (!pending) {
    pending = loadRoom(pageId).finally(() => {
      pendingLoads.delete(pageId);
    });
    pendingLoads.set(pageId, pending);
  }
  return pending;
}

export function addPageClient(room: PageRoom, client: PageClient): void {
  room.clients.add(client);
  ensurePageRedisRelay();
}

export async function removePageClient(
  room: PageRoom,
  client: PageClient,
): Promise<void> {
  room.clients.delete(client);
  if (room.clients.size > 0) return;
  if (room.saveTimer) {
    clearTimeout(room.saveTimer);
    room.saveTimer = null;
  }
  rooms.delete(room.pageId);
  // Last client out: persist before releasing the document.
  try {
    await persistRoom(room);
  } finally {
    room.doc.destroy();
  }
}

/**
 * Drop a cached room without persisting (used when the page row is deleted).
 * Connected clients are closed so a reconnect observes the deletion.
 */
export async function evictPageRoom(pageId: string): Promise<void> {
  const room = rooms.get(pageId);
  if (!room) return;
  if (room.saveTimer) {
    clearTimeout(room.saveTimer);
    room.saveTimer = null;
  }
  rooms.delete(pageId);
  for (const client of room.clients) {
    try {
      client.ws.close(1008, "Page deleted");
    } catch {
      // Already closed.
    }
  }
  room.clients.clear();
  room.doc.destroy();
}

export function hasPageRoom(pageId: string): boolean {
  return rooms.has(pageId);
}

export function sendPageSyncStep1(client: PageClient, doc: Y.Doc): void {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeSyncStep1(encoder, doc);
  client.ws.send(toSendableBytes(encoding.toUint8Array(encoder)));
}

function toBinaryBytes(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof Uint8Array) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (
    typeof SharedArrayBuffer !== "undefined" &&
    data instanceof SharedArrayBuffer
  ) {
    return new Uint8Array(data);
  }
  return null;
}

/**
 * Handle one incoming frame on a page socket. Text frames follow the shared
 * keepalive protocol; binary frames carry the y-protocols wire format.
 */
export function handlePageSocketMessage(
  room: PageRoom,
  client: PageClient,
  evt: MessageEvent<unknown>,
): void {
  const data = evt.data;
  if (typeof data === "string") {
    if (data !== '{"type":"ping"}') {
      client.ws.close(1008, "Unsupported message");
    }
    return;
  }

  const bytes =
    data instanceof Blob ? null : toBinaryBytes(data as ArrayBufferLike);
  if (data instanceof Blob) {
    void data
      .arrayBuffer()
      .then((buffer) => {
        if (buffer.byteLength > PAGE_WS_MAX_BYTES) {
          client.ws.close(1009, "Message too large");
          return;
        }
        handleBinaryBytes(room, client, new Uint8Array(buffer));
      })
      .catch(() => {
        client.ws.close(1008, "Unsupported message");
      });
    return;
  }
  if (!bytes) {
    client.ws.close(1003, "Only text keepalives are supported");
    return;
  }
  if (bytes.byteLength > PAGE_WS_MAX_BYTES) {
    client.ws.close(1009, "Message too large");
    return;
  }
  handleBinaryBytes(room, client, bytes);
}

function handleBinaryBytes(
  room: PageRoom,
  client: PageClient,
  bytes: Uint8Array,
): void {
  let decoder: decoding.Decoder;
  try {
    decoder = decoding.createDecoder(bytes);
  } catch {
    client.ws.close(1008, "Unsupported message");
    return;
  }
  let messageType: number;
  try {
    messageType = decoding.readVarUint(decoder);
  } catch {
    client.ws.close(1008, "Unsupported message");
    return;
  }
  try {
    if (messageType === messageSync) {
      // Read-only sockets may handshake (SyncStep1) so they receive state,
      // but any frame carrying document changes (SyncStep2, Update) from
      // them is dropped before it touches the room document: it is never
      // applied, never relayed, and never persisted. Awareness stays open
      // to everyone so presence keeps working for viewers.
      const innerType = readInnerSyncType(bytes);
      if (innerType === null) {
        client.ws.close(1008, "Unsupported message");
        return;
      }
      if (!client.canEdit && innerType !== syncProtocol.messageYjsSyncStep1) {
        return;
      }
      const encoder = encoding.createEncoder();
      // Replies carry the outer envelope, mirroring y-websocket: the peer
      // feeds the whole frame back into the sync protocol.
      encoding.writeVarUint(encoder, messageSync);
      // NB: `decoder` already consumed the outer byte above, so
      // readSyncMessage lands on the inner sync-step type.
      syncProtocol.readSyncMessage(decoder, encoder, room.doc, client);
      if (encoding.length(encoder) > 1) {
        client.ws.send(toSendableBytes(encoding.toUint8Array(encoder)));
      }
    } else if (messageType === messageAwareness) {
      // Presence only: relay verbatim to the other clients, never persist.
      const relay = toSendableBytes(bytes);
      for (const other of room.clients) {
        if (other === client) continue;
        try {
          other.ws.send(relay);
        } catch {
          // Dead sockets are reaped on close.
        }
      }
    } else {
      client.ws.close(1008, "Unsupported message");
    }
  } catch {
    client.ws.close(1008, "Unsupported message");
  }
}

export type PageAccess = {
  pageId: string;
  projectId: string;
  workspaceId: string;
};

/**
 * Resolve a page to its project/workspace and enforce access. Missing pages
 * and pages in inaccessible projects both surface as 404 so existence is
 * never leaked.
 */
export async function resolvePageAccess(
  userId: string,
  pageId: string,
): Promise<PageAccess> {
  const [row] = await db
    .select({
      pageId: pageTable.id,
      projectId: pageTable.projectId,
      workspaceId: projectTable.workspaceId,
    })
    .from(pageTable)
    .innerJoin(projectTable, eq(pageTable.projectId, projectTable.id))
    .where(eq(pageTable.id, pageId))
    .limit(1);

  if (!row) {
    throw new HTTPException(404, { message: "Page not found" });
  }

  await validateWorkspaceAccess(userId, row.workspaceId, undefined, {
    notFoundMessage: "Page not found",
  });

  try {
    await assertProjectAccess(userId, row.projectId);
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) {
      throw new HTTPException(404, { message: "Page not found" });
    }
    throw error;
  }

  return row;
}
