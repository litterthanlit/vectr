/**
 * Live link between the MCP server and the Vectr app in the browser.
 *
 * Protocol (JSON over WebSocket, localhost only):
 *   server → app  {type:'hello', rev, fresh, doc}
 *                 {type:'doc', rev, doc, activity?, layerIds?}
 *   app → server  {type:'doc', doc}     designer edits (debounced by the app)
 *
 * The designer sees every agent stroke appear as it happens, and the agent's
 * next get_canvas / get_path call sees the designer's hand edits.
 */
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import type { DocStore } from './doc-store';
import type { Doc } from '../src/lib/types';

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function startBridge(store: DocStore, port: number, extraOrigins: string[] = []) {
  const clients = new Map<WebSocket, string>();
  const wss = new WebSocketServer({
    host: '127.0.0.1',
    port,
    maxPayload: 16 * 1024 * 1024,
    // Any web page can try to open ws://localhost; only let the app's own origins in.
    verifyClient: ({ origin }: { origin?: string }) => !origin || LOCAL_ORIGIN.test(origin) || extraOrigins.includes(origin),
  });

  wss.on('listening', () => process.stderr.write(`[vectr] live bridge on ws://127.0.0.1:${port}\n`));
  wss.on('error', (e: NodeJS.ErrnoException) => {
    process.stderr.write(
      e.code === 'EADDRINUSE'
        ? `[vectr] port ${port} is busy (another Vectr MCP running?). Continuing without the live bridge.\n`
        : `[vectr] bridge error: ${e.message}\n`,
    );
  });

  wss.on('connection', (ws) => {
    const id = randomUUID();
    clients.set(ws, id);
    ws.send(JSON.stringify({ type: 'hello', rev: store.rev, fresh: store.fresh, doc: store.doc }));
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as { type: string; doc?: Doc };
        if (msg.type === 'doc' && msg.doc && Array.isArray(msg.doc.layers)) store.receive(msg.doc, id);
      } catch {
        /* ignore malformed frames */
      }
    });
    ws.on('close', () => clients.delete(ws));
  });

  store.onChange((c) => {
    const frame = JSON.stringify({ type: 'doc', rev: c.rev, doc: c.doc, activity: c.activity, layerIds: c.layerIds });
    for (const [ws, id] of clients) if (id !== c.source && ws.readyState === ws.OPEN) ws.send(frame);
  });

  return {
    get connected() {
      return clients.size;
    },
    close: () => wss.close(),
  };
}
