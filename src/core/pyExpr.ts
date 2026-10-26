/** A small evaluator for the subset of Python expressions that aocd's example locators
 * are written in (e.g. "a_code[-1].split()[-1]", "[li.codes[0] for li in a_li[6:]]") —
 * see ../providers/aocExamples.ts. Python semantics are kept where the locators can tell
 * the difference: negative indexing and slicing, str.split()/splitlines(), arbitrary-size
 * ints, an error (thrown as PyError) wherever Python would raise. Anything outside the
 * subset is a PyError too, so a locator this doesn't understand yields no value rather
 * than a wrong one. */

/** Something the expressions can reach that isn't a plain Python value (e.g. an HTML element). */
export interface PyObject {
  getAttr(name: string): PyValue;
  callMethod(name: string, args: PyValue[]): PyValue;
}

class PyBuiltin {
  constructor(readonly name: string) {}
}

/** Lists, tuples and sets are all plain arrays here — no locator relies on telling them apart. */
export type PyValue = string | bigint | boolean | null | PyValue[] | PyObject | PyBuiltin;

export class PyError extends Error {}

type Token = { kind: 'name' | 'num' | 'str' | 'op'; text: string; value?: string | bigint };

const OPERATORS = ['==', '!=', '<=', '>=', '(', ')', '[', ']', '{', '}', ',', '.', ':', '+', '-', '*', '=', '<', '>'];
const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '0': '\0' };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i));
    if (name) {
      tokens.push({ kind: 'name', text: name[0] });
      i += name[0].length;
      continue;
    }
    const num = /^(0[bB][01_]+|0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|\d[\d_]*)/.exec(source.slice(i));
    if (num) {
      // No floats: "1.5" tokenizes as 1 . 5, which then fails as an attribute access.
      tokens.push({ kind: 'num', text: num[0], value: BigInt(num[0].replace(/_/g, '')) });
      i += num[0].length;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let value = '';
      let j = i + 1;
      for (; j < source.length && source[j] !== ch; j++) {
        if (source[j] === '\\') {
          const escaped = source[++j];
          value += ESCAPES[escaped] ?? '\\' + escaped;
        } else {
          value += source[j];
        }
      }
      if (j >= source.length) throw new PyError('unterminated string');
      tokens.push({ kind: 'str', text: source.slice(i, j + 1), value });
      i = j + 1;
      continue;
    }
    const op = OPERATORS.find((o) => source.startsWith(o, i));
    if (!op) throw new PyError(`unexpected character ${JSON.stringify(ch)}`);
    tokens.push({ kind: 'op', text: op });
    i += op.length;
  }
  return tokens;
}

type Expr =
  | { t: 'name'; id: string }
  | { t: 'const'; value: PyValue }
  | { t: 'seq'; items: Expr[] }
  | { t: 'comp'; set: boolean; elt: Expr; target: string; iter: Expr; conds: Expr[] }
  | { t: 'attr'; obj: Expr; name: string }
  | { t: 'call'; fn: Expr; args: Expr[]; kwargs: Record<string, Expr> }
  | { t: 'index'; obj: Expr; index: Expr }
  | { t: 'slice'; obj: Expr; lo?: Expr; hi?: Expr; step?: Expr }
  | { t: 'binop'; op: '+' | '-' | '*'; left: Expr; right: Expr }
  | { t: 'neg'; operand: Expr }
  | { t: 'not'; operand: Expr }
  | { t: 'logic'; op: 'and' | 'or'; left: Expr; right: Expr }
  | { t: 'cmp'; op: string; left: Expr; right: Expr };

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): Expr {
    const expr = this.exprList();
    if (this.pos < this.tokens.length) throw new PyError(`unexpected ${this.tokens[this.pos].text}`);
    return expr;
  }

  private peek(text?: string): Token | undefined {
    const token = this.tokens[this.pos];
    return token && (text === undefined || (token.text === text && token.kind !== 'str')) ? token : undefined;
  }

  private take(text?: string): Token {
    const token = this.peek(text);
    if (!token) throw new PyError(text ? `expected ${text}` : 'unexpected end of expression');
    this.pos++;
    return token;
  }

  private accept(text: string): boolean {
    if (!this.peek(text)) return false;
    this.pos++;
    return true;
  }

  /** "a, b" at the top level or inside parentheses is a tuple. */
  private exprList(): Expr {
    const first = this.expr();
    if (!this.peek(',')) return first;
    const items = [first];
    while (this.accept(',')) {
      if (!this.peek() || this.peek(')')) break;
      items.push(this.expr());
    }
    return { t: 'seq', items };
  }

  private expr(): Expr {
    let left = this.andExpr();
    while (this.accept('or')) left = { t: 'logic', op: 'or', left, right: this.andExpr() };
    return left;
  }

  private andExpr(): Expr {
    let left = this.notExpr();
    while (this.accept('and')) left = { t: 'logic', op: 'and', left, right: this.notExpr() };
    return left;
  }

  private notExpr(): Expr {
    return this.accept('not') ? { t: 'not', operand: this.notExpr() } : this.comparison();
  }

  private comparison(): Expr {
    let left = this.arith();
    for (;;) {
      let op: string | undefined;
      if (this.accept('is')) op = this.accept('not') ? 'is not' : 'is';
      else if (this.accept('in')) op = 'in';
      else if (this.peek('not') && this.tokens[this.pos + 1]?.text === 'in') {
        this.pos += 2;
        op = 'not in';
      } else {
        op = ['==', '!=', '<', '>', '<=', '>='].find((o) => this.accept(o));
      }
      if (!op) return left;
      left = { t: 'cmp', op, left, right: this.arith() };
    }
  }

  private arith(): Expr {
    let left = this.term();
    for (;;) {
      if (this.accept('+')) left = { t: 'binop', op: '+', left, right: this.term() };
      else if (this.accept('-')) left = { t: 'binop', op: '-', left, right: this.term() };
      else return left;
    }
  }

  private term(): Expr {
    let left = this.unary();
    while (this.accept('*')) left = { t: 'binop', op: '*', left, right: this.unary() };
    return left;
  }

  private unary(): Expr {
    return this.accept('-') ? { t: 'neg', operand: this.unary() } : this.postfix();
  }

  private postfix(): Expr {
    let expr = this.atom();
    for (;;) {
      if (this.accept('.')) {
        const name = this.take();
        if (name.kind !== 'name') throw new PyError('expected attribute name');
        expr = { t: 'attr', obj: expr, name: name.text };
      } else if (this.accept('(')) {
        const args: Expr[] = [];
        const kwargs: Record<string, Expr> = {};
        while (!this.accept(')')) {
          if (this.peek()?.kind === 'name' && this.tokens[this.pos + 1]?.text === '=') {
            const key = this.take().text;
            this.take('=');
            kwargs[key] = this.expr();
          } else {
            args.push(this.expr());
          }
          if (!this.peek(')')) this.take(',');
        }
        expr = { t: 'call', fn: expr, args, kwargs };
      } else if (this.accept('[')) {
        const lo = this.peek(':') ? undefined : this.expr();
        if (this.accept(':')) {
          const hi = this.peek(':') || this.peek(']') ? undefined : this.expr();
          const step = this.accept(':') && !this.peek(']') ? this.expr() : undefined;
          expr = { t: 'slice', obj: expr, lo, hi, step };
        } else {
          expr = { t: 'index', obj: expr, index: lo! };
        }
        this.take(']');
      } else {
        return expr;
      }
    }
  }

  private atom(): Expr {
    const token = this.take();
    if (token.kind === 'num' || token.kind === 'str') {
      let value = token.value!;
      // Adjacent string literals concatenate, as in Python.
      while (token.kind === 'str' && this.peek()?.kind === 'str') value += this.take().value as string;
      return { t: 'const', value };
    }
    if (token.kind === 'name') {
      if (token.text === 'None') return { t: 'const', value: null };
      if (token.text === 'True') return { t: 'const', value: true };
      if (token.text === 'False') return { t: 'const', value: false };
      return { t: 'name', id: token.text };
    }
    if (token.text === '(') {
      if (this.accept(')')) return { t: 'seq', items: [] };
      const inner = this.exprList();
      this.take(')');
      return inner;
    }
    if (token.text === '[' || token.text === '{') {
      const close = token.text === '[' ? ']' : '}';
      if (this.accept(close)) {
        if (close === '}') throw new PyError('dicts are not supported');
        return { t: 'seq', items: [] };
      }
      const first = this.expr();
      if (this.accept('for')) {
        const target = this.take();
        if (target.kind !== 'name') throw new PyError('only simple comprehension targets are supported');
        this.take('in');
        const iter = this.expr();
        const conds: Expr[] = [];
        while (this.accept('if')) conds.push(this.expr());
        this.take(close);
        return { t: 'comp', set: close === '}', elt: first, target: target.text, iter, conds };
      }
      const items = [first];
      while (this.accept(',') && !this.peek(close)) items.push(this.expr());
      this.take(close);
      return close === '}' ? { t: 'call', fn: { t: 'name', id: 'set' }, args: [{ t: 'seq', items }], kwargs: {} } : { t: 'seq', items };
    }
    throw new PyError(`unexpected ${token.text}`);
  }
}

// ---- evaluation -------------------------------------------------------------------

function isObject(value: PyValue): value is PyObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof PyBuiltin);
}

function typeName(value: PyValue): string {
  if (value === null) return 'NoneType';
  if (Array.isArray(value)) return 'list';
  if (value instanceof PyBuiltin) return 'builtin';
  return typeof value === 'object' ? 'object' : typeof value;
}

function truthy(value: PyValue): boolean {
  if (value === null || value === false || value === '' || value === 0n) return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Strings are indexed by code point, like Python, not by UTF-16 unit. */
function sequence(value: PyValue): PyValue[] {
  if (typeof value === 'string') return Array.from(value);
  if (Array.isArray(value)) return value;
  throw new PyError(`'${typeName(value)}' object is not iterable`);
}

function toIndex(value: PyValue): number {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value !== 'bigint') throw new PyError('indices must be integers');
  return Number(value);
}

function indexInto(obj: PyValue, index: PyValue): PyValue {
  const items = sequence(obj);
  let i = toIndex(index);
  if (i < 0) i += items.length;
  if (i < 0 || i >= items.length) throw new PyError('index out of range');
  return items[i];
}

function sliceOf(obj: PyValue, lo: PyValue | undefined, hi: PyValue | undefined, stepValue: PyValue | undefined): PyValue {
  const items = sequence(obj);
  const len = items.length;
  const step = stepValue === undefined || stepValue === null ? 1 : toIndex(stepValue);
  if (step === 0) throw new PyError('slice step cannot be zero');
  const bound = (value: PyValue | undefined, fallback: number, min: number, max: number) => {
    if (value === undefined || value === null) return fallback;
    let i = toIndex(value);
    if (i < 0) i += len;
    return Math.min(Math.max(i, min), max);
  };
  const result: PyValue[] = [];
  if (step > 0) {
    for (let i = bound(lo, 0, 0, len), end = bound(hi, len, 0, len); i < end; i += step) result.push(items[i]);
  } else {
    for (let i = bound(lo, len - 1, -1, len - 1), end = bound(hi, -1, -1, len - 1); i > end; i += step) result.push(items[i]);
  }
  return typeof obj === 'string' ? result.join('') : result;
}

function equal(a: PyValue, b: PyValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equal(x, b[i]));
  return a === b;
}

function compare(a: PyValue, b: PyValue): number {
  if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  throw new PyError(`cannot compare ${typeName(a)} and ${typeName(b)}`);
}

function str(value: PyValue): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (value === null) return 'None';
  throw new PyError(`str() of ${typeName(value)} is not supported`);
}

function int(value: PyValue): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'boolean') return value ? 1n : 0n;
  if (typeof value === 'string') {
    const match = /^\s*([+-]?)(\d+(?:_\d+)*)\s*$/.exec(value);
    if (!match) throw new PyError(`invalid literal for int(): ${JSON.stringify(value)}`);
    const n = BigInt(match[2].replace(/_/g, ''));
    return match[1] === '-' ? -n : n;
  }
  throw new PyError(`int() of ${typeName(value)} is not supported`);
}

const PY_WHITESPACE = /[ \t\n\r\f\v\x1c-\x1f\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/;
const PY_LINE_BREAK = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;

function stringMethod(s: string, name: string, args: PyValue[]): PyValue {
  const strArg = (i: number) => {
    const arg = args[i];
    if (typeof arg !== 'string') throw new PyError(`${name}() argument must be str`);
    return arg;
  };
  switch (name) {
    case 'split': {
      if (args.length === 0 || args[0] === null) return s.split(PY_WHITESPACE).filter(Boolean);
      const sep = strArg(0);
      if (!sep) throw new PyError('empty separator');
      return s.split(sep);
    }
    case 'splitlines': {
      const lines = s.split(PY_LINE_BREAK);
      if (lines[lines.length - 1] === '') lines.pop();
      return lines;
    }
    case 'strip':
    case 'lstrip':
    case 'rstrip': {
      if (args.length && args[0] !== null) {
        const chars = new Set(Array.from(strArg(0)));
        const cps = Array.from(s);
        let start = 0;
        let end = cps.length;
        if (name !== 'rstrip') while (start < end && chars.has(cps[start])) start++;
        if (name !== 'lstrip') while (end > start && chars.has(cps[end - 1])) end--;
        return cps.slice(start, end).join('');
      }
      const trimmed = name === 'strip' ? s.trim() : name === 'lstrip' ? s.trimStart() : s.trimEnd();
      return trimmed;
    }
    case 'replace': {
      const old = strArg(0);
      return old ? s.split(old).join(strArg(1)) : s;
    }
    case 'count': {
      const sub = strArg(0);
      return BigInt(sub ? s.split(sub).length - 1 : Array.from(s).length + 1);
    }
    case 'join': {
      const items = sequence(args[0] ?? null);
      if (!items.every((item) => typeof item === 'string')) throw new PyError('join() expects strings');
      return items.join(s);
    }
    case 'format': {
      let next = 0;
      return s.replace(/\{\{|\}\}|\{\}/g, (m) => (m === '{{' ? '{' : m === '}}' ? '}' : str(args[next++] ?? null)));
    }
    case 'isdigit':
      return s.length > 0 && /^\p{Nd}+$/u.test(s);
    case 'startswith':
      return s.startsWith(strArg(0));
    case 'endswith':
      return s.endsWith(strArg(0));
    case 'upper':
      return s.toUpperCase();
    case 'lower':
      return s.toLowerCase();
    default:
      throw new PyError(`str has no method ${name}()`);
  }
}

function callBuiltin(name: string, args: PyValue[], kwargs: Record<string, PyValue>, scope: Scope): PyValue {
  switch (name) {
    case 'str':
      return args.length ? str(args[0]) : '';
    case 'int':
      return args.length ? int(args[0]) : 0n;
    case 'len':
      return BigInt(sequence(args[0] ?? null).length);
    case 'list':
      return args.length ? [...sequence(args[0])] : [];
    case 'set': {
      const unique: PyValue[] = [];
      for (const item of args.length ? sequence(args[0]) : []) if (!unique.some((u) => equal(u, item))) unique.push(item);
      return unique;
    }
    case 'max':
    case 'min': {
      const items = args.length === 1 ? sequence(args[0]) : args;
      if (!items.length) throw new PyError(`${name}() arg is an empty sequence`);
      return items.reduce((best, item) => (compare(item, best) * (name === 'max' ? 1 : -1) > 0 ? item : best));
    }
    case 'sorted': {
      const key = kwargs.key ?? null;
      const keyed = [...sequence(args[0] ?? null)].map((item) => ({ item, k: key === null ? item : call(key, [item], {}, scope) }));
      keyed.sort((a, b) => compare(a.k, b.k));
      if (kwargs.reverse !== undefined && truthy(kwargs.reverse)) keyed.reverse();
      return keyed.map((x) => x.item);
    }
    default:
      throw new PyError(`name '${name}' is not defined`);
  }
}

const BUILTINS = new Set(['str', 'int', 'len', 'list', 'set', 'max', 'min', 'sorted']);

type Scope = Record<string, PyValue>;

function call(fn: PyValue, args: PyValue[], kwargs: Record<string, PyValue>, scope: Scope): PyValue {
  if (fn instanceof PyBuiltin) return callBuiltin(fn.name, args, kwargs, scope);
  throw new PyError(`'${typeName(fn)}' object is not callable`);
}

function evaluateExpr(expr: Expr, scope: Scope): PyValue {
  switch (expr.t) {
    case 'const':
      return expr.value;
    case 'name':
      if (expr.id in scope) return scope[expr.id];
      if (BUILTINS.has(expr.id)) return new PyBuiltin(expr.id);
      throw new PyError(`name '${expr.id}' is not defined`);
    case 'seq':
      return expr.items.map((item) => evaluateExpr(item, scope));
    case 'comp': {
      const results: PyValue[] = [];
      for (const item of sequence(evaluateExpr(expr.iter, scope))) {
        const inner = { ...scope, [expr.target]: item };
        if (expr.conds.every((cond) => truthy(evaluateExpr(cond, inner)))) results.push(evaluateExpr(expr.elt, inner));
      }
      return expr.set ? callBuiltin('set', [results], {}, scope) : results;
    }
    case 'attr': {
      const obj = evaluateExpr(expr.obj, scope);
      if (isObject(obj)) return obj.getAttr(expr.name);
      throw new PyError(`'${typeName(obj)}' object has no attribute '${expr.name}'`);
    }
    case 'call': {
      const args = expr.args.map((arg) => evaluateExpr(arg, scope));
      const kwargs = Object.fromEntries(Object.entries(expr.kwargs).map(([k, v]) => [k, evaluateExpr(v, scope)]));
      if (expr.fn.t === 'attr') {
        const obj = evaluateExpr(expr.fn.obj, scope);
        if (typeof obj === 'string') return stringMethod(obj, expr.fn.name, args);
        if (isObject(obj)) return obj.callMethod(expr.fn.name, args);
        throw new PyError(`'${typeName(obj)}' object has no attribute '${expr.fn.name}'`);
      }
      return call(evaluateExpr(expr.fn, scope), args, kwargs, scope);
    }
    case 'index':
      return indexInto(evaluateExpr(expr.obj, scope), evaluateExpr(expr.index, scope));
    case 'slice': {
      const part = (e?: Expr) => (e ? evaluateExpr(e, scope) : undefined);
      return sliceOf(evaluateExpr(expr.obj, scope), part(expr.lo), part(expr.hi), part(expr.step));
    }
    case 'binop': {
      const left = evaluateExpr(expr.left, scope);
      const right = evaluateExpr(expr.right, scope);
      if (typeof left === 'bigint' && typeof right === 'bigint') {
        return expr.op === '+' ? left + right : expr.op === '-' ? left - right : left * right;
      }
      if (expr.op === '+' && typeof left === 'string' && typeof right === 'string') return left + right;
      if (expr.op === '+' && Array.isArray(left) && Array.isArray(right)) return [...left, ...right];
      if (expr.op === '*') {
        const [seq, n] = typeof right === 'bigint' ? [left, right] : [right, left];
        if (typeof n === 'bigint' && (typeof seq === 'string' || Array.isArray(seq))) {
          const times = Math.max(0, Number(n));
          return typeof seq === 'string' ? seq.repeat(times) : Array.from({ length: times }, () => seq).flat();
        }
      }
      throw new PyError(`unsupported operand types for ${expr.op}: ${typeName(left)} and ${typeName(right)}`);
    }
    case 'neg': {
      const value = evaluateExpr(expr.operand, scope);
      if (typeof value !== 'bigint') throw new PyError(`bad operand type for unary -: ${typeName(value)}`);
      return -value;
    }
    case 'not':
      return !truthy(evaluateExpr(expr.operand, scope));
    case 'logic': {
      const left = evaluateExpr(expr.left, scope);
      if (expr.op === 'and' ? !truthy(left) : truthy(left)) return left;
      return evaluateExpr(expr.right, scope);
    }
    case 'cmp': {
      const left = evaluateExpr(expr.left, scope);
      const right = evaluateExpr(expr.right, scope);
      switch (expr.op) {
        case 'is':
          return left === right;
        case 'is not':
          return left !== right;
        case '==':
          return equal(left, right);
        case '!=':
          return !equal(left, right);
        case 'in':
        case 'not in': {
          const found =
            typeof right === 'string' && typeof left === 'string' ? right.includes(left) : sequence(right).some((item) => equal(item, left));
          return expr.op === 'in' ? found : !found;
        }
        default: {
          const c = compare(left, right);
          return expr.op === '<' ? c < 0 : expr.op === '>' ? c > 0 : expr.op === '<=' ? c <= 0 : c >= 0;
        }
      }
    }
  }
}

/** Evaluates one Python expression against `scope` (names -> values). Throws PyError for
 * anything Python would raise on, or anything outside the supported subset. */
export function evaluate(source: string, scope: Scope): PyValue {
  return evaluateExpr(new Parser(tokenize(source)).parse(), scope);
}
