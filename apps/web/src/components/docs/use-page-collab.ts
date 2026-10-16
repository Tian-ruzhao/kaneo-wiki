import { windowId } from "@kaneo/libs";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { useCallback, useEffect, useRef, useState } from "react";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { getApiUrl } from "@/fetchers/get-api-url";

export type PageSyncState = "saved" | "saving" | "offline" | "reconnecting";

export type PagePresenceUser = {
  clientId: number;
  name: string;
  color: string;
};

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const WS_PING_INTERVAL_MS = 30_000;
const SAVE_IDLE_MS = 1200;
const MAX_RETRIES = 5;

const PRESENCE_COLORS = [
  "#7c6cf0",
  "#2f9e6e",
  "#e08a3c",
  "#d6537e",
  "#3c8fd6",
  "#b08a2e",
];

export function getPageWsUrl(pageId: string) {
  const wsBase = getApiUrl("ws").replace(/^http/, "ws");
  return `${wsBase}/page/${encodeURIComponent(pageId)}?windowId=${encodeURIComponent(windowId)}`;
}

function colorForName(name: string) {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) | 0;
  }
  return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length] as string;
}

type UsePageCollabOptions = {
  pageId: string | null;
  displayName: string;
};

/**
 * Owns one Y.Doc per open page plus its page WebSocket. The document
 * survives reconnects, so edits made while offline merge when the socket
 * comes back. The server speaks the y-protocols wire format on binary
 * frames: sync (messageSync = 0) for content, awareness (1) for presence.
 */
export function usePageCollab({ pageId, displayName }: UsePageCollabOptions) {
  const [doc, setDoc] = useState<Y.Doc | null>(null);
  const [syncState, setSyncState] = useState<PageSyncState>("saving");
  const [deleted, setDeleted] = useState(false);
  const [peers, setPeers] = useState<PagePresenceUser[]>([]);
  const reconnectRef = useRef<() => void>(() => {});
  const nameRef = useRef(displayName);
  nameRef.current = displayName;

  useEffect(() => {
    if (!pageId) return;
    const activePageId: string = pageId;
    let disposed = false;
    const ydoc = new Y.Doc();
    setDoc(ydoc);
    setDeleted(false);
    setPeers([]);
    setSyncState("saving");

    const name = nameRef.current || "Someone";
    const awareness = new awarenessProtocol.Awareness(ydoc);
    awareness.setLocalState({
      user: { name, color: colorForName(name) },
    });

    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let retries = 0;

    const scheduleSaved = () => {
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        if (!disposed && socket?.readyState === WebSocket.OPEN) {
          setSyncState("saved");
        }
      }, SAVE_IDLE_MS);
    };

    // Local edits arrive with a non-null origin; network updates are applied
    // with a null origin below, so only local edits are sent (no echo) and
    // flip the dot to saving.
    const onDocUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === null) return;
      if (disposed || socket?.readyState !== WebSocket.OPEN) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      try {
        socket.send(encoding.toUint8Array(encoder));
      } catch {
        // A dead socket is reaped on close; the reconnect re-handshakes and
        // the surviving Y.Doc merges, so the edit is not lost.
      }
      setSyncState("saving");
      scheduleSaved();
    };
    ydoc.on("update", onDocUpdate);

    const onAwarenessChange = () => {
      if (disposed) return;
      const next: PagePresenceUser[] = [];
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID) return;
        const user = (state as { user?: { name?: string; color?: string } })
          .user;
        if (!user?.name) return;
        next.push({
          clientId,
          name: user.name,
          color: user.color ?? colorForName(user.name),
        });
      });
      next.sort((a, b) => a.name.localeCompare(b.name));
      setPeers(next);
    };
    awareness.on("change", onAwarenessChange);

    const sendAwareness = () => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, [
          awareness.clientID,
        ]),
      );
      socket.send(encoding.toUint8Array(encoder));
    };
    const onLocalAwarenessUpdate = () => sendAwareness();
    awareness.on("update", onLocalAwarenessUpdate);

    function cleanupSocket() {
      if (pingTimer !== null) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        try {
          socket.close();
        } catch {
          // Already closed.
        }
        socket = null;
      }
    }

    function connect() {
      if (disposed) return;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      cleanupSocket();
      setSyncState(retries === 0 ? "saving" : "reconnecting");
      const ws = new WebSocket(getPageWsUrl(activePageId));
      socket = ws;
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        if (disposed || socket !== ws) return;
        retries = 0;
        // Full two-way handshake: our Step1 asks the server for its diff,
        // the server's Step1 (sent on open) is answered in onmessage.
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.writeSyncStep1(encoder, ydoc);
        ws.send(encoding.toUint8Array(encoder));
        sendAwareness();
        pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, WS_PING_INTERVAL_MS);
      };

      const handleBytes = (buffer: ArrayBuffer) => {
        const bytes = new Uint8Array(buffer);
        let decoder: decoding.Decoder;
        try {
          decoder = decoding.createDecoder(bytes);
          const messageType = decoding.readVarUint(decoder);
          if (messageType === MESSAGE_SYNC) {
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, MESSAGE_SYNC);
            syncProtocol.readSyncMessage(decoder, encoder, ydoc, null);
            if (encoding.length(encoder) > 1) {
              ws.send(encoding.toUint8Array(encoder));
            }
            scheduleSaved();
          } else if (messageType === MESSAGE_AWARENESS) {
            awarenessProtocol.applyAwarenessUpdate(
              awareness,
              decoding.readVarUint8Array(decoder),
              "remote",
            );
          }
        } catch {
          // Ignore malformed frames; the sync protocol recovers on retry.
        }
      };

      ws.onmessage = (event) => {
        if (disposed || socket !== ws) return;
        const data = event.data as unknown;
        if (typeof data === "string") return;
        if (data instanceof Blob) {
          void data
            .arrayBuffer()
            .then((buffer) => {
              if (!disposed && socket === ws) handleBytes(buffer);
            })
            .catch(() => {});
          return;
        }
        if (data instanceof ArrayBuffer) handleBytes(data);
      };

      ws.onclose = (event) => {
        if (disposed || socket !== ws) return;
        cleanupSocket();
        // The server closes with 1008/"Page deleted" when the room is
        // evicted after a delete; a reconnect would fail forever.
        if (event?.code === 1008) {
          setDeleted(true);
          setSyncState("offline");
          return;
        }
        if (retries < MAX_RETRIES) {
          const delay = 1000 * 2 ** retries;
          retries += 1;
          setSyncState("reconnecting");
          retryTimer = setTimeout(connect, delay);
        } else {
          setSyncState("offline");
        }
      };
    }

    reconnectRef.current = () => {
      retries = 0;
      setDeleted(false);
      connect();
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      if (saveTimer !== null) clearTimeout(saveTimer);
      cleanupSocket();
      awareness.destroy();
      ydoc.destroy();
      setDoc(null);
    };
  }, [pageId]);

  const retry = useCallback(() => {
    setSyncState("reconnecting");
    reconnectRef.current();
  }, []);

  return { doc, syncState, deleted, peers, retry };
}
