/**
 * A small, safe maths expression language for the Formula source: numbers, + - * / % ^,
 * parentheses, named variables and a fixed set of functions. It is parsed into
 * closures; nothing is ever evaluated as JavaScript, so a design file cannot run code.
 */
import { noise3 } from './geo.js';

export type Vars = Record<string, number>;
export type Compiled = (vars: Vars) => number;

export const MAX_EXPR_LENGTH = 200;
const MAX_DEPTH = 64;

const noise = noise3(1, 5);

const FUNCS: Record<string, { arity: [number, number]; f: (...a: number[]) => number }> = {
  sin: { arity: [1, 1], f: Math.sin },
  cos: { arity: [1, 1], f: Math.cos },
  tan: { arity: [1, 1], f: Math.tan },
  asin: { arity: [1, 1], f: Math.asin },
  acos: { arity: [1, 1], f: Math.acos },
  atan: { arity: [1, 1], f: Math.atan },
  atan2: { arity: [2, 2], f: Math.atan2 },
  sinh: { arity: [1, 1], f: Math.sinh },
  cosh: { arity: [1, 1], f: Math.cosh },
  tanh: { arity: [1, 1], f: Math.tanh },
  abs: { arity: [1, 1], f: Math.abs },
  sqrt: { arity: [1, 1], f: Math.sqrt },
  exp: { arity: [1, 1], f: Math.exp },
  log: { arity: [1, 1], f: Math.log },
  pow: { arity: [2, 2], f: Math.pow },
  min: { arity: [1, 8], f: Math.min },
  max: { arity: [1, 8], f: Math.max },
  floor: { arity: [1, 1], f: Math.floor },
  ceil: { arity: [1, 1], f: Math.ceil },
  round: { arity: [1, 1], f: Math.round },
  sign: { arity: [1, 1], f: Math.sign },
  mod: { arity: [2, 2], f: (a, b) => (b ? ((a % b) + b) % b : 0) },
  clamp: { arity: [3, 3], f: (x, lo, hi) => Math.min(hi, Math.max(lo, x)) },
  noise: { arity: [1, 3], f: (x, y = 0, z = 0) => noise([x, y, z]) },
};

const CONSTS: Record<string, number> = { pi: Math.PI, tau: Math.PI * 2, e: Math.E };

export const EXPR_FUNCTIONS = Object.keys(FUNCS);

export class ExprError extends Error {}

type Tok = { k: 'num'; v: number } | { k: 'id'; v: string } | { k: 'op'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
    if (num) { out.push({ k: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    const id = /^[a-z_][a-z0-9_]*/i.exec(src.slice(i));
    if (id) { out.push({ k: 'id', v: id[0].toLowerCase() }); i += id[0].length; continue; }
    if ('+-*/%^(),'.includes(c)) { out.push({ k: 'op', v: c }); i++; continue; }
    if (c === '×') { out.push({ k: 'op', v: '*' }); i++; continue; }
    if (c === '−') { out.push({ k: 'op', v: '-' }); i++; continue; }
    throw new ExprError(`unexpected "${c}"`);
  }
  return out;
}

/**
 * Compile an expression. `allowed` lists the variable names it may use; anything
 * else is an error, so typos are reported instead of silently reading zero.
 */
export function compile(src: string, allowed: string[]): Compiled {
  if (src.length > MAX_EXPR_LENGTH) throw new ExprError(`longer than ${MAX_EXPR_LENGTH} characters`);
  const toks = tokenize(src);
  if (!toks.length) throw new ExprError('empty');
  let i = 0;
  const peek = () => toks[i];
  const isOp = (v: string) => peek()?.k === 'op' && peek().v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new ExprError(`expected "${v}"`);
    i++;
  };
  const vars = new Set(allowed);

  const bin = (a: Compiled, b: Compiled, op: string): Compiled => {
    switch (op) {
      case '+': return (x) => a(x) + b(x);
      case '-': return (x) => a(x) - b(x);
      case '*': return (x) => a(x) * b(x);
      case '/': return (x) => a(x) / b(x);
      case '%': return (x) => a(x) % b(x);
      default: return (x) => Math.pow(a(x), b(x));
    }
  };

  const expr = (d: number): Compiled => {
    if (d > MAX_DEPTH) throw new ExprError('nested too deeply');
    let left = term(d);
    while (isOp('+') || isOp('-')) {
      const op = String(toks[i++].v);
      left = bin(left, term(d), op);
    }
    return left;
  };
  const term = (d: number): Compiled => {
    let left = unary(d);
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = String(toks[i++].v);
      left = bin(left, unary(d), op);
    }
    return left;
  };
  const unary = (d: number): Compiled => {
    if (isOp('-')) { i++; const a = unary(d + 1); return (x) => -a(x); }
    if (isOp('+')) { i++; return unary(d + 1); }
    return power(d);
  };
  const power = (d: number): Compiled => {
    const base = atom(d);
    if (isOp('^')) { i++; return bin(base, unary(d + 1), '^'); } // right-associative
    return base;
  };
  const atom = (d: number): Compiled => {
    const t = peek();
    if (!t) throw new ExprError('unexpected end');
    if (t.k === 'num') { i++; const v = t.v; return () => v; }
    if (t.k === 'op' && t.v === '(') {
      i++;
      const inner = expr(d + 1);
      expect(')');
      return inner;
    }
    if (t.k === 'id') {
      i++;
      if (isOp('(')) {
        const fn = Object.hasOwn(FUNCS, t.v) ? FUNCS[t.v] : undefined;
        if (!fn) throw new ExprError(`unknown function "${t.v}"`);
        i++;
        const args: Compiled[] = [];
        if (!isOp(')')) {
          args.push(expr(d + 1));
          while (isOp(',')) { i++; args.push(expr(d + 1)); }
        }
        expect(')');
        if (args.length < fn.arity[0] || args.length > fn.arity[1]) throw new ExprError(`${t.v} takes ${fn.arity[0] === fn.arity[1] ? fn.arity[0] : `${fn.arity[0]}–${fn.arity[1]}`} argument(s)`);
        const f = fn.f;
        if (args.length === 1) { const [a] = args; return (x) => f(a(x)); }
        if (args.length === 2) { const [a, b] = args; return (x) => f(a(x), b(x)); }
        return (x) => f(...args.map((a) => a(x)));
      }
      if (Object.hasOwn(CONSTS, t.v)) { const v = CONSTS[t.v]; return () => v; }
      if (vars.has(t.v)) { const name = t.v; return (x) => (Object.hasOwn(x, name) ? x[name] : 0); }
      throw new ExprError(`unknown name "${t.v}" (use ${[...vars, 'pi', 'tau', 'e'].join(', ')})`);
    }
    throw new ExprError(`unexpected "${t.v}"`);
  };

  const out = expr(0);
  if (i < toks.length) throw new ExprError(`unexpected "${toks[i].v}"`);
  return out;
}
