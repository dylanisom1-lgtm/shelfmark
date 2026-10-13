// The search box's calculator. A small parser, never eval() (which extension pages forbid anyway).
//
// Understands:  + - * / ^ (or **), parentheses, × ÷ − and "3 x 4"
//               15%        a percentage: "15% of 80" is 12, "1450 + 6%" is 1537
//               7 % 3, 7 mod 3   remainder
//               5!         factorial
//               1,450      thousands commas (outside function calls)
//               0xFF 0b1010 0o17, and "255 in hex" / "to binary" / "as octal" / "in decimal"
//               sqrt cbrt abs round floor ceil ln log log2 exp sin cos tan asin acos atan min max pow
//               pi, π, e
//
// evaluate(text) returns null when the text doesn't look like a sum, so ordinary searches
// ("o365", "2fa", "pi-hole") never show an answer. Starting with "=" always tries, and
// reports what's wrong.

const MAX_LEN = 240;

const CONSTS = { pi: Math.PI, 'π': Math.PI, e: Math.E, tau: 2 * Math.PI };

const FUNCS = {
  sqrt: [1, 1, (x) => Math.sqrt(x)],
  cbrt: [1, 1, (x) => Math.cbrt(x)],
  abs: [1, 1, (x) => Math.abs(x)],
  round: [1, 2, (x, d = 0) => { const f = 10 ** d; return Math.round(x * f) / f; }],
  floor: [1, 1, (x) => Math.floor(x)],
  ceil: [1, 1, (x) => Math.ceil(x)],
  ln: [1, 1, (x) => Math.log(x)],
  log: [1, 2, (x, b) => (b === undefined ? Math.log10(x) : Math.log(x) / Math.log(b))],
  log2: [1, 1, (x) => Math.log2(x)],
  log10: [1, 1, (x) => Math.log10(x)],
  exp: [1, 1, (x) => Math.exp(x)],
  sin: [1, 1, Math.sin],
  cos: [1, 1, Math.cos],
  tan: [1, 1, Math.tan],
  asin: [1, 1, Math.asin],
  acos: [1, 1, Math.acos],
  atan: [1, 1, Math.atan],
  min: [1, 99, (...a) => Math.min(...a)],
  max: [1, 99, (...a) => Math.max(...a)],
  pow: [2, 2, (a, b) => a ** b],
};

const BASES = {
  hex: 16, hexadecimal: 16,
  bin: 2, binary: 2,
  oct: 8, octal: 8,
  dec: 10, decimal: 10,
};

class CalcError extends Error {}

// --- tokens ----------------------------------------------------------------------
function lex(src) {
  const toks = [];
  const parens = []; // 'f' for a function call's parentheses, 'g' for grouping
  let i = 0;
  const prev = () => toks[toks.length - 1];
  const operandEnded = () => {
    const p = prev();
    return p && (p.t === 'num' || p.t === 'const' || (p.t === 'op' && (p.v === ')' || p.v === '%' || p.v === '!')));
  };
  while (i < src.length) {
    const rest = src.slice(i);
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    let m;
    if ((m = /^0x[0-9a-f]+/i.exec(rest))) { toks.push({ t: 'num', v: parseInt(m[0].slice(2), 16), raw: m[0], base: 16 }); i += m[0].length; continue; }
    if ((m = /^0b[01]+/i.exec(rest))) { toks.push({ t: 'num', v: parseInt(m[0].slice(2), 2), raw: m[0], base: 2 }); i += m[0].length; continue; }
    if ((m = /^0o[0-7]+/i.exec(rest))) { toks.push({ t: 'num', v: parseInt(m[0].slice(2), 8), raw: m[0], base: 8 }); i += m[0].length; continue; }
    if (parens[parens.length - 1] !== 'f' && (m = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\d,])/.exec(rest))) {
      toks.push({ t: 'num', v: Number(m[0].replace(/,/g, '')), raw: m[0] });
      i += m[0].length;
      continue;
    }
    if ((m = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(rest))) { toks.push({ t: 'num', v: Number(m[0]), raw: m[0] }); i += m[0].length; continue; }
    // "3 x 4" and "3x4" multiply; checked before names so "x4" isn't read as one.
    if ((c === 'x' || c === 'X') && operandEnded() && /^[xX]\s*[\d.(]/.test(rest)) { toks.push({ t: 'op', v: '*' }); i++; continue; }
    if ((m = /^[a-zπ_][a-z0-9_]*/i.exec(rest))) {
      const w = m[0].toLowerCase();
      i += m[0].length;
      if (w === 'of') { toks.push({ t: 'op', v: 'of' }); continue; }
      if (w === 'mod') { toks.push({ t: 'op', v: 'mod' }); continue; }
      if (w in CONSTS) { toks.push({ t: 'const', v: CONSTS[w], raw: w === 'π' ? 'π' : w }); continue; }
      if (w in FUNCS) { toks.push({ t: 'fn', v: w }); continue; }
      throw new CalcError(`“${m[0]}” isn’t something the calculator knows.`);
    }
    if (rest.startsWith('**')) { toks.push({ t: 'op', v: '^' }); i += 2; continue; }
    const map = { '+': '+', '-': '-', '−': '-', '–': '-', '*': '*', '×': '*', '·': '*', '/': '/', '÷': '/', '^': '^', '%': '%', '!': '!', '(': '(', ')': ')', ',': ',' };
    if (map[c]) {
      const v = map[c];
      if (v === '(') parens.push(prev() && prev().t === 'fn' ? 'f' : 'g');
      if (v === ')') parens.pop();
      toks.push({ t: 'op', v });
      i++;
      continue;
    }
    throw new CalcError(`The calculator can’t read “${c}”.`);
  }
  return toks;
}

// --- parser: precedence climbing into a small tree -------------------------------
function parse(toks) {
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;
  const startsOperand = (t) => t && (t.t === 'num' || t.t === 'const' || t.t === 'fn' || (t.t === 'op' && (t.v === '(' || t.v === '-' || t.v === '+')));

  function expr() {
    let left = term();
    while (isOp('+') || isOp('-')) {
      const op = toks[p++].v;
      left = { k: 'bin', op, a: left, b: term() };
    }
    return left;
  }
  function term() {
    let left = unary();
    for (;;) {
      if (isOp('*') || isOp('/') || isOp('mod') || isOp('of')) {
        const op = toks[p++].v;
        left = { k: 'bin', op: op === 'of' ? '*' : op, a: left, b: unary() };
      } else if (isOp('%') && startsOperand(toks[p + 1])) {
        p++;
        left = { k: 'bin', op: 'mod', a: left, b: unary() };
      } else return left;
    }
  }
  function unary() {
    if (isOp('-')) { p++; return { k: 'neg', e: unary() }; }
    if (isOp('+')) { p++; return unary(); }
    return power();
  }
  function power() {
    const base = postfix();
    if (isOp('^')) {
      p++;
      return { k: 'bin', op: '^', a: base, b: unary() }; // right-associative; 2^-1 works
    }
    return base;
  }
  function postfix() {
    let e = primary();
    for (;;) {
      if (isOp('!')) { p++; e = { k: 'fact', e }; continue; }
      // "%" followed by something to work on is a remainder, handled in term()
      if (isOp('%') && !startsOperand(toks[p + 1])) { p++; e = { k: 'pct', e }; continue; }
      return e;
    }
  }
  function primary() {
    const t = toks[p];
    if (!t) throw new CalcError('The sum ends too soon.');
    if (t.t === 'num') { p++; return { k: 'num', v: t.v, base: t.base }; }
    if (t.t === 'const') { p++; return { k: 'num', v: t.v, isConst: true }; }
    if (t.t === 'fn') {
      p++;
      if (!isOp('(')) throw new CalcError(`Put brackets after ${t.v}, like ${t.v}(2).`);
      p++;
      const args = [];
      if (!isOp(')')) {
        args.push(expr());
        while (isOp(',')) { p++; args.push(expr()); }
      }
      if (!isOp(')')) throw new CalcError('A bracket isn’t closed.');
      p++;
      const [lo, hi] = FUNCS[t.v];
      if (args.length < lo || args.length > hi) throw new CalcError(`${t.v} takes ${lo === hi ? lo : `${lo} to ${hi}`} number${hi === 1 ? '' : 's'}.`);
      return { k: 'fn', name: t.v, args };
    }
    if (t.t === 'op' && t.v === '(') {
      p++;
      const e = expr();
      if (!isOp(')')) throw new CalcError('A bracket isn’t closed.');
      p++;
      return e;
    }
    throw new CalcError(t.v === ')' ? 'There’s a closing bracket without an opening one.' : `Something’s missing before “${t.v}”.`);
  }

  const tree = expr();
  if (p < toks.length) {
    const t = toks[p];
    throw new CalcError(t.v === ')' ? 'There’s a closing bracket without an opening one.' : `Something’s missing before “${t.raw || t.v}”.`);
  }
  return tree;
}

function factorial(n) {
  if (!Number.isInteger(n) || n < 0) throw new CalcError('Factorials need a whole number of 0 or more.');
  if (n > 170) return Infinity;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function ev(n) {
  switch (n.k) {
    case 'num': return n.v;
    case 'pct': return ev(n.e) / 100;
    case 'neg': return -ev(n.e);
    case 'fact': return factorial(ev(n.e));
    case 'fn': return FUNCS[n.name][2](...n.args.map(ev));
    case 'bin': {
      const a = ev(n.a);
      // "1450 + 6%" means 1450 plus 6% of 1450, as on a desk calculator.
      if ((n.op === '+' || n.op === '-') && n.b.k === 'pct') {
        const pct = ev(n.b.e) / 100;
        return n.op === '+' ? a + a * pct : a - a * pct;
      }
      const b = ev(n.b);
      switch (n.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/':
          if (b === 0) throw new CalcError('Can’t divide by zero.');
          return a / b;
        case 'mod':
          if (b === 0) throw new CalcError('Can’t divide by zero.');
          return a % b;
        case '^': return a ** b;
      }
    }
  }
  throw new CalcError('The calculator couldn’t work that out.');
}

// True when the tree does some arithmetic, rather than being a lone number or constant.
function doesWork(n) {
  if (n.k === 'num') return !!n.base; // "0xFF" on its own converts to decimal
  if (n.k === 'neg') return doesWork(n.e); // "-5" is just a number
  return true;
}

// --- output ----------------------------------------------------------------------
// Fractions are rounded to 12 significant digits, which hides floating-point noise
// (0.1 + 0.2 = 0.3). Whole numbers are left exact, so 2^40 is 1099511627776.
export function tidy(x) {
  if (!Number.isFinite(x) || x === 0 || Number.isInteger(x)) return x;
  return Number(x.toPrecision(12));
}

export function formatNumber(x) {
  const v = tidy(x);
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e21 || a < 1e-9)) {
    const [m, e] = v.toExponential(8).split('e');
    return `${m.replace(/\.?0+$/, '')} × 10^${Number(e)}`;
  }
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 12 }).format(v);
}

function plainNumber(x) {
  const v = tidy(x);
  return String(v);
}

function inBase(x, base) {
  if (!Number.isInteger(x)) throw new CalcError('Only whole numbers convert to hex, binary or octal.');
  if (Math.abs(x) > Number.MAX_SAFE_INTEGER) throw new CalcError('That number is too big to convert exactly.');
  const sign = x < 0 ? '-' : '';
  const digits = Math.abs(x).toString(base).toUpperCase();
  const prefix = { 16: '0x', 2: '0b', 8: '0o' }[base];
  const grouped = base === 2 ? digits.replace(/\B(?=(\d{4})+(?!\d))/g, ' ') : base === 16 ? digits.replace(/\B(?=([0-9A-F]{4})+(?![0-9A-F]))/g, ' ') : digits;
  return { copy: sign + prefix + digits, text: sign + prefix + grouped };
}

function pretty(toks) {
  const show = { '*': '×', '/': '÷', '-': '−', mod: 'mod', of: 'of' };
  let out = '';
  toks.forEach((t, i) => {
    const prev = toks[i - 1];
    let s;
    if (t.t === 'num' || t.t === 'const') s = t.raw;
    else if (t.t === 'fn') s = t.v;
    else s = show[t.v] || t.v;
    const tight =
      !prev ||
      (t.t === 'op' && (t.v === ')' || t.v === '%' || t.v === '!' || t.v === ',' || t.v === '^')) ||
      (prev.t === 'op' && (prev.v === '(' || prev.v === '^')) ||
      (prev.t === 'fn') ||
      (t.t === 'op' && t.v === '(' && prev.t === 'fn') ||
      (prev.t === 'op' && prev.v === '-' && isUnary(toks, i - 1));
    out += (tight ? '' : ' ') + s;
  });
  return out;
}

// A minus sign is a negative sign when nothing it could subtract from comes before it.
function isUnary(toks, i) {
  const p = toks[i - 1];
  return !p || (p.t === 'op' && ![')', '%', '!'].includes(p.v)) || p.t === 'fn';
}

// Returns null (not a sum), { error } (only when forced with "="), or
// { expr, text, copy, alt? }: the tidied sum, the answer to show, the answer to copy.
export function evaluate(input) {
  if (typeof input !== 'string') return null;
  let src = input.trim();
  const forced = src.startsWith('=');
  if (forced) src = src.slice(1).trim();
  if (!src || src.length > MAX_LEN) return forced && src ? { error: 'That sum is too long.' } : null;
  if (!forced && !/\d|π|\bpi\b/i.test(src)) return null;

  let base = null;
  const conv = /\s+(?:in|to|as)\s+(hex|hexadecimal|bin|binary|oct|octal|dec|decimal)\s*$/i.exec(src);
  if (conv) {
    base = BASES[conv[1].toLowerCase()];
    src = src.slice(0, conv.index);
  }

  try {
    const toks = lex(src);
    if (!toks.length) return forced ? { error: 'Type a sum after the =.' } : null;
    const tree = parse(toks);
    if (!forced && !base && !doesWork(tree)) return null;
    const value = ev(tree);
    if (!Number.isFinite(value)) throw new CalcError(Number.isNaN(value) ? 'That doesn’t have an answer.' : 'The answer is too big to show.');
    const expr = pretty(toks) + (base ? ` in ${{ 16: 'hex', 2: 'binary', 8: 'octal', 10: 'decimal' }[base]}` : '');
    if (base && base !== 10) {
      const r = inBase(value, base);
      return { expr, text: r.text, copy: r.copy, alt: formatNumber(value) };
    }
    const out = { expr, text: formatNumber(value), copy: plainNumber(value) };
    // Typed in hex or binary? Show the answer that way too.
    const typedBase = !base && toks.find((t) => t.base) && toks.find((t) => t.base).base;
    if (typedBase && Number.isInteger(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) out.alt = inBase(value, typedBase).text;
    return out;
  } catch (err) {
    if (err instanceof CalcError) return forced ? { error: err.message } : null;
    throw err;
  }
}
