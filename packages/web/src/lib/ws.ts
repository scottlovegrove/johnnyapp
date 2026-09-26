import { useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage } from "@johnny/shared";

type Listener = (msg: ServerMessage) => void;

/**
 * Single reconnecting websocket shared by the whole app. Messages queued while
 * disconnected are flushed on reconnect.
 */
class Socket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private queue: ClientMessage[] = [];
  private retry = 0;
  status: "connecting" | "open" | "closed" = "connecting";
  private statusListeners = new Set<(s: Socket["status"]) => void>();

  constructor() {
    this.connect();
  }

  private connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    this.setStatus("connecting");

    ws.onopen = () => {
      this.retry = 0;
      this.setStatus("open");
      for (const msg of this.queue.splice(0)) ws.send(JSON.stringify(msg));
    };
    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data as string) as ServerMessage;
      for (const l of this.listeners) l(msg);
    };
    ws.onclose = () => {
      this.setStatus("closed");
      const delay = Math.min(10_000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

  private setStatus(s: Socket["status"]) {
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }

  send(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: (s: Socket["status"]) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }
}

export const socket = new Socket();

/** Subscribe to server messages for the lifetime of the component. */
export function useSocket(listener: Listener) {
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(() => socket.on((msg) => ref.current(msg)), []);
}

export function useSocketStatus() {
  const [status, setStatus] = useState(socket.status);
  useEffect(() => socket.onStatus(setStatus), []);
  return status;
}
