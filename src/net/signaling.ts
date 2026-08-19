/**
 * Client side of the signaling protocol (Section 5). The server (server/signaling.mjs)
 * is a dumb relay keyed by room code: it brokers 'host'/'join' room membership and
 * forwards 'signal' payloads (SDP offers/answers, ICE candidates) between the two
 * peers in a room. It never looks inside a signal payload.
 *
 * The socket is injected so this is unit-testable without a real WebSocket — jsdom's
 * `environment: 'node'` test config has no WebSocket global at all.
 */

export type ServerMessage =
  | { type: 'hosted' }
  | { type: 'joined' }
  | { type: 'peer-joined' }
  | { type: 'peer-left' }
  | { type: 'signal'; payload: unknown }
  | { type: 'error'; message: string };

export type ClientMessage =
  | { type: 'host'; code: string }
  | { type: 'join'; code: string }
  | { type: 'signal'; payload: unknown };

export interface MinimalSocketEvent {
  data?: string;
}

export interface MinimalSocket {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', handler: (ev: MinimalSocketEvent) => void): void;
}

export type SocketFactory = (url: string) => MinimalSocket;

/** Default port of server/signaling.mjs. */
export const DEFAULT_SIGNAL_PORT = 8787;

/**
 * Derives the signaling URL from the page's own origin.
 *
 * The scheme MUST track the page's: a page served over https:// cannot open a ws://
 * socket, because both Safari and Chrome block it as mixed content with no user
 * override. Since getUserMedia forces the app onto https in the first place, a
 * hardcoded ws:// would make pairing impossible on every device that matters, and
 * would do so only on real hardware — never in a unit test with an injected socket.
 */
export function defaultSignalingUrl(
  loc: { protocol: string; hostname: string } = typeof location !== 'undefined'
    ? location
    : { protocol: 'http:', hostname: 'localhost' },
  port: number = DEFAULT_SIGNAL_PORT,
): string {
  const scheme = loc.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${loc.hostname}:${port}`;
}

export interface SignalingClient {
  host(code: string): void;
  join(code: string): void;
  sendSignal(payload: unknown): void;
  onMessage(handler: (msg: ServerMessage) => void): () => void;
  onOpen(handler: () => void): () => void;
  onClose(handler: () => void): () => void;
  close(): void;
}

function defaultSocketFactory(url: string): MinimalSocket {
  return new WebSocket(url) as unknown as MinimalSocket;
}

export function createSignalingClient(
  url: string,
  socketFactory: SocketFactory = defaultSocketFactory,
): SignalingClient {
  const socket = socketFactory(url);
  const messageHandlers = new Set<(msg: ServerMessage) => void>();
  const openHandlers = new Set<() => void>();
  const closeHandlers = new Set<() => void>();

  socket.addEventListener('open', () => {
    for (const h of openHandlers) h();
  });
  socket.addEventListener('close', () => {
    for (const h of closeHandlers) h();
  });
  socket.addEventListener('message', (ev) => {
    if (typeof ev.data !== 'string') return;
    let msg: ServerMessage;
    try {
      msg = JSON.parse(ev.data) as ServerMessage;
    } catch {
      return;
    }
    for (const h of messageHandlers) h(msg);
  });

  const send = (msg: ClientMessage): void => socket.send(JSON.stringify(msg));

  return {
    host(code) {
      send({ type: 'host', code });
    },
    join(code) {
      send({ type: 'join', code });
    },
    sendSignal(payload) {
      send({ type: 'signal', payload });
    },
    onMessage(handler) {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },
    onOpen(handler) {
      openHandlers.add(handler);
      return () => openHandlers.delete(handler);
    },
    onClose(handler) {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
    close() {
      socket.close();
    },
  };
}
