// Minimal signaling relay for camera pairing (Section 5). Rooms are keyed by the
// 6-char code the host displays. This server never looks inside 'signal' payloads —
// it only brokers room membership and forwards offer/answer/ICE between the two
// peers in a room. No video, no detections, no fusion happens here.

import { WebSocketServer } from 'ws';
import { createServer } from 'node:https';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const PORT = Number(process.env.SIGNAL_PORT ?? 8787);

/**
 * The app is served over HTTPS, because getUserMedia demands a secure context and
 * iOS grants no LAN exception. A page on https:// cannot open a ws:// socket —
 * Safari and Chrome both block it as mixed content — so this server has to speak
 * wss://, sharing the same mkcert certificate the dev server uses.
 *
 * Falls back to plain ws:// when certs/ is absent, which only works for a page
 * served over http://localhost.
 */
const certDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'certs');
const certFile = join(certDir, 'dev-cert.pem');
const keyFile = join(certDir, 'dev-key.pem');
const haveCerts = existsSync(certFile) && existsSync(keyFile);

function lanAddress() {
  for (const entries of Object.values(networkInterfaces())) {
    for (const e of entries ?? []) {
      if (e.family === 'IPv4' && !e.internal) return e.address;
    }
  }
  return 'localhost';
}

/** @type {Map<string, { host: import('ws').WebSocket | null, peer: import('ws').WebSocket | null }>} */
const rooms = new Map();

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function roomOf(ws) {
  for (const [code, room] of rooms) {
    if (room.host === ws || room.peer === ws) return code;
  }
  return null;
}

function leaveRoom(ws) {
  const code = roomOf(ws);
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;
  const other = room.host === ws ? room.peer : room.host;
  if (room.host === ws) room.host = null;
  if (room.peer === ws) room.peer = null;
  if (other) send(other, { type: 'peer-left' });
  if (!room.host && !room.peer) rooms.delete(code);
}

let wss;
let scheme;
if (haveCerts) {
  const httpsServer = createServer({
    key: readFileSync(keyFile),
    cert: readFileSync(certFile),
  });
  // A plain GET is useful for confirming reachability from the iPad's browser
  // before any pairing code exists.
  httpsServer.on('request', (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('trainr signaling server ok\n');
  });
  httpsServer.listen(PORT);
  wss = new WebSocketServer({ server: httpsServer });
  scheme = 'wss';
} else {
  wss = new WebSocketServer({ port: PORT });
  scheme = 'ws';
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'host' && typeof msg.code === 'string') {
      if (rooms.has(msg.code)) {
        send(ws, { type: 'error', message: 'code already in use' });
        return;
      }
      rooms.set(msg.code, { host: ws, peer: null });
      send(ws, { type: 'hosted' });
      return;
    }

    if (msg.type === 'join' && typeof msg.code === 'string') {
      const room = rooms.get(msg.code);
      if (!room || !room.host) {
        send(ws, { type: 'error', message: 'session not found' });
        return;
      }
      room.peer = ws;
      send(ws, { type: 'joined' });
      send(room.host, { type: 'peer-joined' });
      return;
    }

    if (msg.type === 'signal') {
      const code = roomOf(ws);
      const room = code ? rooms.get(code) : null;
      if (!room) return;
      const other = room.host === ws ? room.peer : room.host;
      if (other) send(other, { type: 'signal', payload: msg.payload });
    }
  });

  ws.on('close', () => leaveRoom(ws));
});

console.log(`signaling server listening on ${scheme}://${lanAddress()}:${PORT}`);
if (!haveCerts) {
  console.log('WARNING: no certs/ found, so this is ws:// only. An https:// page will refuse to connect.');
}
