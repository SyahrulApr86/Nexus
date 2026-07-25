import type { RealtimeEvent } from "@nexus/shared";

/**
 * Per-vault rooms (US10). Sockets register on WS upgrade; broadcasts fan out
 * to every open session of the same vault except the originating one when
 * an origin socket id is provided.
 */

type Listener = (event: RealtimeEvent) => void;

const rooms = new Map<string, Set<Listener>>();

export function joinVault(vaultId: string, listener: Listener): () => void {
  let room = rooms.get(vaultId);
  if (!room) {
    room = new Set();
    rooms.set(vaultId, room);
  }
  room.add(listener);
  return () => {
    room!.delete(listener);
    if (room!.size === 0) rooms.delete(vaultId);
  };
}

export function broadcastToVault(vaultId: string, event: RealtimeEvent): void {
  const room = rooms.get(vaultId);
  if (!room) return;
  for (const listener of room) {
    try {
      listener(event);
    } catch {
      /* dead socket — cleanup happens on close */
    }
  }
}
