/**
 * Browser side of the MCP live bridge (see mcp/bridge.ts). Connects to the
 * local Vectr MCP server, applies agent changes as undoable steps and streams
 * the designer's edits back so the agent always sees the current canvas.
 */
import { isApplyingRemote, useStore } from '../store';
import type { Doc } from './types';

export const AGENT_URL: string =
  new URLSearchParams(location.search).get('agent') ?? import.meta.env.VITE_VECTR_AGENT_URL ?? 'ws://127.0.0.1:7331';

let ws: WebSocket | null = null;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let sendTimer: ReturnType<typeof setTimeout> | undefined;
let started = false;

const sameDoc = (a: Doc, b: Doc) => JSON.stringify(a) === JSON.stringify(b);

function connect() {
  clearTimeout(retryTimer);
  const { setAgent } = useStore.getState();
  setAgent({ status: 'connecting' });
  let socket: WebSocket;
  try {
    socket = new WebSocket(AGENT_URL);
  } catch {
    setAgent({ status: 'off' });
    return;
  }
  ws = socket;
  socket.onopen = () => {
    retry = 0;
    setAgent({ status: 'live' });
  };
  socket.onmessage = (ev) => {
    let msg: { type: string; doc?: Doc; fresh?: boolean; activity?: string; layerIds?: string[] };
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    const st = useStore.getState();
    if (msg.type === 'hello') {
      // A brand-new server adopts the designer's canvas; otherwise the server's copy wins.
      if (msg.fresh || !msg.doc) send(st.doc);
      else if (!sameDoc(msg.doc, st.doc)) st.applyRemote(msg.doc, 'Connected to agent canvas');
      else st.setAgent({ activity: 'Agent connected', at: Date.now() });
    } else if (msg.type === 'doc' && msg.doc) {
      st.applyRemote(msg.doc, msg.activity, msg.layerIds);
    }
  };
  socket.onclose = () => {
    if (ws === socket) ws = null;
    useStore.getState().setAgent({ status: 'off' });
    // Quiet back-off: the MCP server may simply not be running yet.
    retry = Math.min(retry + 1, 6);
    retryTimer = setTimeout(connect, Math.min(15000, 1000 * 2 ** retry));
  };
}

function send(doc: Doc) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'doc', doc }));
}

export function startAgentLink() {
  if (started || typeof WebSocket === 'undefined') return;
  started = true;
  connect();
  useStore.subscribe((s, prev) => {
    if (s.doc === prev.doc || isApplyingRemote()) return;
    clearTimeout(sendTimer);
    sendTimer = setTimeout(() => send(useStore.getState().doc), 120);
  });
  // Reconnect promptly when the tab comes back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !ws) {
      retry = 0;
      connect();
    }
  });
}

export function reconnectAgent() {
  retry = 0;
  if (!ws) connect();
}
