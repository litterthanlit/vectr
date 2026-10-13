/**
 * Is a key event aimed at something the user is typing into (or operating with
 * the keyboard)? Global shortcuts — 1–6 variations, Space to pan, Delete, V/O/P/M,
 * arrow nudges — must stand down for these, or typing "1 2 3" into a text field
 * would pick variations and a Space would start a pan.
 *
 * Covers text inputs of every type, textareas, selects (type-ahead) and
 * contentEditable regions. Range sliders are deliberately not "typing": they stay
 * focused after a drag, and the shortcuts should still work then.
 *
 * Duck-typed on `tagName` / `isContentEditable` so it works across frames and in
 * non-DOM test environments.
 */
export function isTyping(e: { target: EventTarget | null }): boolean {
  const t = e.target as { tagName?: unknown; type?: unknown; isContentEditable?: unknown } | null;
  if (!t || typeof t.tagName !== 'string') return false;
  if (t.isContentEditable === true) return true;
  switch (t.tagName) {
    case 'TEXTAREA':
    case 'SELECT':
      return true;
    case 'INPUT':
      return t.type !== 'range';
    default:
      return false;
  }
}
