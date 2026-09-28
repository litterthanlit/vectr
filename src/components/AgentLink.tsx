import { Bot, Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AGENT_URL, reconnectAgent, startAgentLink } from '../lib/agent-link';
import { useStore } from '../store';

const CONFIG = `{
  "mcpServers": {
    "vectr": {
      "command": "npx",
      "args": ["tsx", "<path-to-vectr>/mcp/server.ts"]
    }
  }
}`;

/** Header pill: live agent status, the latest agent action, and setup help. */
export function AgentLink() {
  const status = useStore((s) => s.agent.status);
  const activity = useStore((s) => s.agent.activity);
  const at = useStore((s) => s.agent.at);
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => startAgentLink(), []);

  // Briefly show what the agent just did next to the pill.
  useEffect(() => {
    if (!activity || !at) return;
    setFlash(activity);
    const t = setTimeout(() => setFlash(null), 2600);
    return () => clearTimeout(t);
  }, [activity, at]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const live = status === 'live';
  const label = live ? 'Agent live' : status === 'connecting' ? 'Connecting…' : 'Connect agent';

  return (
    <div ref={ref} className="relative flex items-center">
      <span role="status" aria-live="polite" className="sr-only">{flash ?? ''}</span>
      {flash && (
        <span className="vectr-pop mr-2 hidden max-w-[260px] truncate rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[12px] text-emerald-200 md:inline">
          {flash}
        </span>
      )}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`inline-flex h-8 items-center gap-2 rounded-lg px-2.5 text-[13px] transition focus-visible:outline-2 focus-visible:outline-orange-400 ${
          live ? 'text-emerald-200 hover:bg-emerald-400/10' : 'text-zinc-400 hover:bg-white/[0.06] hover:text-white'
        }`}
      >
        <span className="relative flex h-2 w-2" aria-hidden="true">
          {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:animate-none" />}
          <span className={`relative inline-flex h-2 w-2 rounded-full ${live ? 'bg-emerald-400' : status === 'connecting' ? 'bg-amber-400' : 'bg-zinc-600'}`} />
        </span>
        <Bot size={15} className="sm:hidden" aria-hidden="true" />
        <span className="hidden sm:inline">{label}</span>
      </button>
      {open && (
        <div role="dialog" aria-label="Agent connection" className="vectr-pop absolute top-full right-0 z-50 mt-2 w-[340px] rounded-xl border border-white/10 bg-zinc-900/90 p-4 text-[13px] shadow-2xl backdrop-blur-xl">
          <h2 className="font-medium text-white">{live ? 'An agent is drawing with you' : 'Let an agent draw here'}</h2>
          <p className="mt-1.5 leading-relaxed text-zinc-400">
            {live
              ? 'Agent strokes appear live and each one is a single undo step. Your edits flow back, so the agent always sees the current canvas.'
              : 'Add the Vectr MCP server to Claude (or any MCP client). This page connects to it automatically.'}
          </p>
          {!live && (
            <>
              <div className="relative mt-3">
                <pre className="overflow-x-auto rounded-lg bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-zinc-300 ring-1 ring-white/[0.06]">{CONFIG}</pre>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(CONFIG).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {})}
                  aria-label="Copy MCP config"
                  className="absolute top-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-white"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
              <p className="mt-2 text-[12px] text-zinc-500">
                Or for Claude Code: <code className="font-mono text-zinc-300">claude mcp add vectr -- npx tsx mcp/server.ts</code>
              </p>
              <div className="mt-3 flex items-center justify-between">
                <span className="font-mono text-[11px] text-zinc-600">{AGENT_URL}</span>
                <button type="button" onClick={reconnectAgent} className="rounded-md px-2 py-1 text-[12px] text-orange-300 hover:bg-orange-400/10">
                  Retry now
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
