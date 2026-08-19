import { describe, expect, it, vi } from 'vitest';
import { createSignalingClient, defaultSignalingUrl, type MinimalSocket, type MinimalSocketEvent } from '../signaling';

class FakeSocket implements MinimalSocket {
  sent: string[] = [];
  closed = false;
  private listeners: Record<string, ((ev: MinimalSocketEvent) => void)[]> = {};

  addEventListener(type: 'open' | 'message' | 'close' | 'error', handler: (ev: MinimalSocketEvent) => void): void {
    (this.listeners[type] ??= []).push(handler);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.emit('close', {});
  }

  emit(type: string, ev: MinimalSocketEvent): void {
    for (const h of this.listeners[type] ?? []) h(ev);
  }
}

describe('signaling client', () => {
  it('encodes host/join/sendSignal as the expected JSON envelopes', () => {
    let socket!: FakeSocket;
    const client = createSignalingClient('ws://example', (url) => {
      expect(url).toBe('ws://example');
      socket = new FakeSocket();
      return socket;
    });

    client.host('ABC234');
    client.join('XYZ789');
    client.sendSignal({ kind: 'offer', sdp: 'fake' });

    expect(JSON.parse(socket.sent[0])).toEqual({ type: 'host', code: 'ABC234' });
    expect(JSON.parse(socket.sent[1])).toEqual({ type: 'join', code: 'XYZ789' });
    expect(JSON.parse(socket.sent[2])).toEqual({ type: 'signal', payload: { kind: 'offer', sdp: 'fake' } });
  });

  it('dispatches parsed server messages to onMessage handlers', () => {
    let socket!: FakeSocket;
    const client = createSignalingClient('ws://x', (u) => {
      void u;
      socket = new FakeSocket();
      return socket;
    });

    const handler = vi.fn();
    client.onMessage(handler);
    socket.emit('message', { data: JSON.stringify({ type: 'peer-joined' }) });

    expect(handler).toHaveBeenCalledWith({ type: 'peer-joined' });
  });

  it('ignores malformed message payloads instead of throwing', () => {
    let socket!: FakeSocket;
    const client = createSignalingClient('ws://x', () => (socket = new FakeSocket()));
    const handler = vi.fn();
    client.onMessage(handler);
    expect(() => socket.emit('message', { data: 'not json' })).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it('fires open and close handlers and unsubscribes cleanly', () => {
    let socket!: FakeSocket;
    const client = createSignalingClient('ws://x', () => (socket = new FakeSocket()));
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const unsubOpen = client.onOpen(onOpen);
    client.onClose(onClose);

    socket.emit('open', {});
    unsubOpen();
    socket.emit('open', {});
    expect(onOpen).toHaveBeenCalledTimes(1);

    client.close();
    expect(socket.closed).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('defaultSignalingUrl', () => {
  // Regression guard for a mixed-content failure that only appears on real
  // hardware: an https:// page silently cannot open a ws:// socket, so pairing
  // would fail on every device while every unit test with an injected socket passed.
  it('uses wss when the page is https', () => {
    expect(defaultSignalingUrl({ protocol: 'https:', hostname: '192.168.1.92' })).toBe(
      'wss://192.168.1.92:8787',
    );
  });

  it('uses ws when the page is plain http', () => {
    expect(defaultSignalingUrl({ protocol: 'http:', hostname: 'localhost' })).toBe(
      'ws://localhost:8787',
    );
  });

  it('honours a custom port', () => {
    expect(defaultSignalingUrl({ protocol: 'https:', hostname: 'host' }, 9000)).toBe(
      'wss://host:9000',
    );
  });
});
