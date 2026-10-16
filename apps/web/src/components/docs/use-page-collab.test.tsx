import { act, renderHook, waitFor } from "@testing-library/react";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { usePageCollab } from "./use-page-collab";

const MESSAGE_SYNC = 0;

// Minimal in-memory peer: speaks the same y-protocols wire format as the
// real page room (applies client updates, answers Step1 with Step1).
class FakeSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeSocket[] = [];

  readonly url: string;
  readyState = 0;
  binaryType = "";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: Uint8Array[] = [];

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  send(data: Uint8Array) {
    this.sent.push(data);
    serverReceive(this, data);
  }

  close() {
    this.readyState = FakeSocket.CLOSED;
  }

  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  receive(bytes: Uint8Array) {
    const copy = new Uint8Array(bytes);
    this.onmessage?.({ data: copy.buffer as ArrayBuffer });
  }
}

const serverDoc = new Y.Doc();

function serverReceive(sock: FakeSocket, data: Uint8Array) {
  const decoder = decoding.createDecoder(new Uint8Array(data));
  if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return;
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.readSyncMessage(decoder, encoder, serverDoc, "server");
  if (encoding.length(encoder) > 1) {
    queueMicrotask(() => sock.receive(encoding.toUint8Array(encoder)));
  }
}

function innerSyncType(frame: Uint8Array): number {
  const decoder = decoding.createDecoder(new Uint8Array(frame));
  decoding.readVarUint(decoder); // outer messageSync envelope
  return decoding.readVarUint(decoder);
}

vi.stubGlobal("WebSocket", FakeSocket as unknown as typeof WebSocket);

afterEach(() => {
  FakeSocket.instances = [];
  // Fresh server state per test (clear without destroying the shared doc).
  Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(new Y.Doc()), "test-reset");
  serverDoc.getText("t").delete(0, serverDoc.getText("t").length);
});

describe("usePageCollab sync", () => {
  it("sends local edits to the server as Yjs updates (no silent local-only mode)", async () => {
    const { result, unmount } = renderHook(() =>
      usePageCollab({ pageId: "page-1", displayName: "Tester" }),
    );
    try {
      expect(FakeSocket.instances).toHaveLength(1);
      const sock = FakeSocket.instances[0] as FakeSocket;
      await act(async () => {
        sock.open();
      });
      // Handshake settles to saved (idle timer is 1200ms).
      await waitFor(() => expect(result.current.syncState).toBe("saved"), {
        timeout: 8000,
      });
      expect(result.current.doc).not.toBeNull();
      const clientDoc = result.current.doc as Y.Doc;

      const sentBefore = sock.sent.length;
      // A local edit (non-null origin, like the Tiptap binding produces).
      act(() => {
        clientDoc.transact(() => {
          clientDoc.getText("t").insert(0, "hi");
        }, "local-test");
      });

      await waitFor(() => expect(serverDoc.getText("t").toString()).toBe("hi"));
      const updateFrames = sock.sent
        .slice(sentBefore)
        .filter((frame) => innerSyncType(frame) === 2);
      expect(updateFrames.length).toBeGreaterThan(0);
    } finally {
      unmount();
    }
  });

  it("does not echo remote-applied updates back to the server", async () => {
    const { result, unmount } = renderHook(() =>
      usePageCollab({ pageId: "page-2", displayName: "Tester" }),
    );
    try {
      const sock = FakeSocket.instances[
        FakeSocket.instances.length - 1
      ] as FakeSocket;
      await act(async () => {
        sock.open();
      });
      await waitFor(() => expect(result.current.syncState).toBe("saved"), {
        timeout: 8000,
      });
      const sentBefore = sock.sent.length;
      // Remote updates are applied with a null origin and must not echo.
      act(() => {
        Y.applyUpdate(
          result.current.doc as Y.Doc,
          Y.encodeStateAsUpdate(serverDoc),
        );
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(sock.sent.length).toBe(sentBefore);
    } finally {
      unmount();
    }
  });
});
