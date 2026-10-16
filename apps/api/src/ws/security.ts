import { HTTPException } from "hono/http-exception";
import type { WSContext } from "hono/ws";

export const MAX_WEBSOCKET_MESSAGE_BYTES = 64;

// Binary Yjs sync frames on the page route may carry whole document states.
export const MAX_PAGE_WEBSOCKET_MESSAGE_BYTES = 1024 * 1024;

export function assertWebSocketOrigin(headers: Headers) {
  const origin = headers.get("origin");
  if (origin === null) {
    // Native clients may omit Origin, but must supply explicit credentials.
    // authenticateApiRequest still validates them and rejects invalid tokens;
    // a cookie alone must never bypass the browser-origin boundary.
    if (
      /^Bearer\s+\S+$/i.test(headers.get("authorization") ?? "") ||
      headers.get("x-api-key")?.trim()
    ) {
      return;
    }
  } else {
    const configured = [
      process.env.KANEO_CLIENT_URL,
      process.env.KANEO_API_URL,
      ...(process.env.CORS_ORIGINS ?? "").split(","),
    ];
    if (process.env.NODE_ENV !== "production") {
      if (!process.env.KANEO_CLIENT_URL)
        configured.push("http://localhost:5173");
      if (!process.env.KANEO_API_URL) configured.push("http://localhost:1337");
    }
    for (const value of configured) {
      if (!value?.trim()) continue;
      try {
        const url = new URL(value.trim());
        if (
          (url.protocol === "https:" || url.protocol === "http:") &&
          !url.username &&
          !url.password &&
          url.origin === origin
        ) {
          return;
        }
      } catch {
        // Invalid entries and wildcards do not grant access.
      }
    }
  }
  throw new HTTPException(403, { message: "WebSocket origin is not allowed" });
}

export function handleWebSocketMessage(
  evt: MessageEvent<unknown>,
  ws: WSContext,
) {
  if (typeof evt.data !== "string") {
    ws.close(1003, "Only text keepalives are supported");
    return;
  }
  if (
    evt.data.length > MAX_WEBSOCKET_MESSAGE_BYTES ||
    Buffer.byteLength(evt.data, "utf8") > MAX_WEBSOCKET_MESSAGE_BYTES
  ) {
    ws.close(1009, "Message too large");
    return;
  }
  // Both web clients send this exact keepalive. No arbitrary JSON needs to be
  // parsed, copied or dispatched. Receiving it is enough to keep proxies alive.
  if (evt.data !== '{"type":"ping"}') {
    ws.close(1008, "Unsupported message");
  }
}

function byteLengthOfMessage(data: unknown): number {
  if (typeof data === "string") return Buffer.byteLength(data, "utf8");
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (
    typeof SharedArrayBuffer !== "undefined" &&
    data instanceof SharedArrayBuffer
  )
    return data.byteLength;
  if (ArrayBuffer.isView(data)) {
    return (data as ArrayBufferView).byteLength;
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) return data.size;
  return 0;
}

/**
 * Size gate for the text-ping routes (/ws/user, /ws/:projectId).
 *
 * The socket-level maxPayload is raised globally so the page route can carry
 * Yjs binary frames, so these routes enforce their 64-byte cap here instead.
 * Oversized frames close with 1009 before reaching application delivery, and
 * binary frames stay rejected (binary is accepted only on the page route).
 */
export function handleSizedWebSocketMessage(
  evt: MessageEvent<unknown>,
  ws: WSContext,
) {
  if (byteLengthOfMessage(evt.data) > MAX_WEBSOCKET_MESSAGE_BYTES) {
    ws.close(1009, "Message too large");
    return;
  }
  handleWebSocketMessage(evt, ws);
}
