// @ts-check
// expr.js: the expression language of a JSON spec, the declarative twin of `fn`.
//
//   "fill": { "expr": "datum.share > 50 ? '#EE7B5E' : '#50AEB7'" }
//
// A JavaScript-expression subset: literals, the option's variables, property
// access, arithmetic, comparison, logic, a ternary, array and object literals, and
// calls to the built-ins below. It is parsed to a tree and compiled to closures;
// nothing is evaluated as code, and only own properties are read.

import * as d3 from 'd3';

/** @param {any} v @returns {Date} */
const toDate = (v) => (v instanceof Date ? v : new Date(v));

/** A row's value as a number, or NaN. @param {any} row @param {string} field */
const numberAt = (row, field) => {
    const v = row == null ? undefined : row[field];
    if (v instanceof Date) return v.getTime();
    return typeof v === 'number' ? v : NaN;
};

/** The finite values of a column. @param {any} rows @param {string} field @returns {number[]} */
const column = (rows, field) => (Array.isArray(rows) ? rows : [])
    .map((row) => numberAt(row, field)).filter((v) => Number.isFinite(v));

/** @type {Map<string, (v: any) => string>} */
const numberFormats = new Map();
/** @type {Map<string, (v: Date) => string>} */
const timeFormats = new Map();

/**
 * The functions an expression may call. Row aggregates take the rows and a field name.
 * @type {Record<string, (...args: any[]) => any>}
 */
export const EXPR_FUNCTIONS = {
    abs: Math.abs,
    min: Math.min,
    max: Math.max,
    round: Math.round,
    floor: Math.floor,
    ceil: Math.ceil,
    sqrt: Math.sqrt,
    pow: Math.pow,
    clamp: (v, lo, hi) => Math.min(Math.max(v, lo), hi),
    /** A number through a d3-format specifier. */
    format: (v, specifier = '') => {
        let fmt = numberFormats.get(specifier);
        if (!fmt) numberFormats.set(specifier, (fmt = d3.format(specifier)));
        return v == null ? '' : fmt(v);
    },
    /** A date through a d3-time-format specifier. */
    timeFormat: (v, specifier = '%Y-%m-%d') => {
        let fmt = timeFormats.get(specifier);
        if (!fmt) timeFormats.set(specifier, (fmt = d3.timeFormat(specifier)));
        return v == null ? '' : fmt(toDate(v));
    },
    year: (v) => toDate(v).getFullYear(),
    /** 0 is January, as in JavaScript. */
    month: (v) => toDate(v).getMonth(),
    day: (v) => toDate(v).getDate(),
    length: (v) => (v == null ? 0 : v.length),
    slice: (v, start, end) => (v == null ? v : v.slice(start, end)),
    includes: (v, item) => (v == null ? false : v.includes(item)),
    lower: (v) => String(v).toLowerCase(),
    upper: (v) => String(v).toUpperCase(),
    string: (v) => (v == null ? '' : String(v)),
    number: (v) => Number(v),
    sum: (rows, field) => d3.sum(column(rows, field)),
    mean: (rows, field) => d3.mean(column(rows, field)),
    median: (rows, field) => d3.median(column(rows, field)),
    minOf: (rows, field) => d3.min(column(rows, field)),
    maxOf: (rows, field) => d3.max(column(rows, field)),
    extent: (rows, field) => d3.extent(column(rows, field)),
    count: (rows) => (Array.isArray(rows) ? rows.length : 0),
    distinct: (rows, field) => [...new Set((Array.isArray(rows) ? rows : []).map((row) => (row == null ? undefined : row[field])))],
};

/** Names that are values, not variables. @type {Record<string, any>} */
const CONSTANTS = { true: true, false: false, null: null, undefined, NaN, Infinity };

/** Property names an expression may never read. */
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

/** Binary operators by precedence, lowest first. */
const BINARY = [['??'], ['||'], ['&&'], ['==', '!=', '===', '!=='], ['<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%']];
const PRECEDENCE = new Map(BINARY.flatMap((ops, level) => ops.map((op) => /** @type {[string, number]} */ ([op, level + 1]))));
const PUNCTUATION = ['===', '!==', '==', '!=', '<=', '>=', '&&', '||', '??', '(', ')', '[', ']', '{', '}', ',', '.', ':', '?', '<', '>', '+', '-', '*', '/', '%', '!'];

/**
 * @typedef {{ kind: 'number' | 'string' | 'name' | 'op' | 'end', value: any, at: number }} Token
 * @typedef {{ type: string, [key: string]: any }} Node
 */

/**
 * @param {string} source
 * @returns {Token[]}
 */
function tokenize(source) {
    /** @type {Token[]} */
    const tokens = [];
    let i = 0;
    while (i < source.length) {
        const ch = source[i];
        if (/\s/.test(ch)) { i += 1; continue; }
        const number = /^(?:\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)/.exec(source.slice(i));
        if (number) {
            tokens.push({ kind: 'number', value: Number(number[0]), at: i });
            i += number[0].length;
            continue;
        }
        if (ch === '"' || ch === "'") {
            let text = '';
            let j = i + 1;
            for (; j < source.length && source[j] !== ch; j++) {
                if (source[j] === '\\' && j + 1 < source.length) {
                    j += 1;
                    text += ({ n: '\n', t: '\t' })[source[j]] ?? source[j];
                } else {
                    text += source[j];
                }
            }
            if (j >= source.length) throw new SyntaxError(`unterminated string at ${i}`);
            tokens.push({ kind: 'string', value: text, at: i });
            i = j + 1;
            continue;
        }
        const name = /^[A-Za-z_$][\w$]*/.exec(source.slice(i));
        if (name) {
            tokens.push({ kind: 'name', value: name[0], at: i });
            i += name[0].length;
            continue;
        }
        const op = PUNCTUATION.find((p) => source.startsWith(p, i));
        if (!op) throw new SyntaxError(`unexpected "${ch}" at ${i}`);
        tokens.push({ kind: 'op', value: op, at: i });
        i += op.length;
    }
    tokens.push({ kind: 'end', value: null, at: source.length });
    return tokens;
}

/**
 * Parse an expression to a tree.
 * @param {string} source
 * @returns {Node}
 */
export function parseExpr(source) {
    const tokens = tokenize(source);
    let pos = 0;
    const peek = () => tokens[pos];
    const next = () => tokens[pos++];
    /** @param {string} op */
    const isOp = (op) => peek().kind === 'op' && peek().value === op;
    /** @param {string} op */
    const expect = (op) => {
        if (!isOp(op)) throw new SyntaxError(`expected "${op}" at ${peek().at}`);
        next();
    };

    /** @returns {Node} */
    function ternary() {
        const test = binary(1);
        if (!isOp('?')) return test;
        next();
        const yes = ternary();
        expect(':');
        return { type: 'ternary', test, yes, no: ternary() };
    }

    /** @param {number} level @returns {Node} */
    function binary(level) {
        let left = unary();
        for (;;) {
            const t = peek();
            const prec = t.kind === 'op' ? PRECEDENCE.get(t.value) : undefined;
            if (!prec || prec < level) return left;
            next();
            left = { type: 'binary', op: t.value, left, right: binary(prec + 1) };
        }
    }

    /** @returns {Node} */
    function unary() {
        const t = peek();
        if (t.kind === 'op' && (t.value === '-' || t.value === '+' || t.value === '!')) {
            next();
            return { type: 'unary', op: t.value, arg: unary() };
        }
        return postfix();
    }

    /** @returns {Node} */
    function postfix() {
        let node = primary();
        for (;;) {
            if (isOp('.')) {
                next();
                const t = next();
                if (t.kind !== 'name') throw new SyntaxError(`expected a property name at ${t.at}`);
                node = { type: 'member', object: node, key: { type: 'literal', value: t.value } };
            } else if (isOp('[')) {
                next();
                const key = ternary();
                expect(']');
                node = { type: 'member', object: node, key };
            } else if (isOp('(')) {
                if (node.type !== 'name') throw new SyntaxError(`only the built-in functions can be called (at ${peek().at})`);
                next();
                node = { type: 'call', name: node.name, args: list(')') };
            } else {
                return node;
            }
        }
    }

    /** Comma-separated expressions up to `close`. @param {string} close @returns {Node[]} */
    function list(close) {
        /** @type {Node[]} */
        const items = [];
        while (!isOp(close)) {
            items.push(ternary());
            if (!isOp(close)) expect(',');
        }
        next();
        return items;
    }

    /** @returns {Node} */
    function primary() {
        const t = next();
        if (t.kind === 'number' || t.kind === 'string') return { type: 'literal', value: t.value };
        if (t.kind === 'name') return { type: 'name', name: t.value };
        if (t.kind === 'op' && t.value === '(') {
            const inner = ternary();
            expect(')');
            return inner;
        }
        if (t.kind === 'op' && t.value === '[') return { type: 'array', items: list(']') };
        if (t.kind === 'op' && t.value === '{') {
            /** @type {{ key: string, value: Node }[]} */
            const entries = [];
            while (!isOp('}')) {
                const k = next();
                if (k.kind !== 'name' && k.kind !== 'string' && k.kind !== 'number') {
                    throw new SyntaxError(`expected a property name at ${k.at}`);
                }
                expect(':');
                entries.push({ key: String(k.value), value: ternary() });
                if (!isOp('}')) expect(',');
            }
            next();
            return { type: 'object', entries };
        }
        throw new SyntaxError(t.kind === 'end' ? 'unexpected end of expression' : `unexpected "${t.value}" at ${t.at}`);
    }

    const tree = ternary();
    if (peek().kind !== 'end') throw new SyntaxError(`unexpected "${peek().value}" at ${peek().at}`);
    return tree;
}

/**
 * Read one own property. Inherited ones (methods, the prototype chain) are not readable.
 * @param {any} object
 * @param {any} key
 * @returns {any}
 */
function read(object, key) {
    if (object == null) return undefined;
    if (FORBIDDEN.has(String(key))) throw new Error(`[elicit] expr: "${key}" cannot be read.`);
    return Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined;
}

/** @type {Record<string, (a: any, b: any) => any>} */
const OPERATORS = {
    '==': (a, b) => a === b,
    '===': (a, b) => a === b,
    '!=': (a, b) => a !== b,
    '!==': (a, b) => a !== b,
    '<': (a, b) => a < b,
    '<=': (a, b) => a <= b,
    '>': (a, b) => a > b,
    '>=': (a, b) => a >= b,
    '+': (a, b) => a + b,
    '-': (a, b) => a - b,
    '*': (a, b) => a * b,
    '/': (a, b) => a / b,
    '%': (a, b) => a % b,
};

/**
 * Compile an expression to a function.
 * @param {string} source
 * @param {string[] | string} params the function's parameter names, which are the
 *   expression's variables; `'ctx'` for one context object whose keys are the variables
 * @returns {(...args: any[]) => any}
 */
export function compileExpr(source, params) {
    const tree = parseExpr(source);
    const names = Array.isArray(params) ? params : null;

    /**
     * @param {Node} node
     * @returns {(args: any[]) => any}
     */
    function build(node) {
        switch (node.type) {
            case 'literal': {
                const { value } = node;
                return () => value;
            }
            case 'name': {
                const { name } = node;
                if (name in CONSTANTS) {
                    const value = CONSTANTS[name];
                    return () => value;
                }
                if (!names) return (args) => read(args[0], name);
                const index = names.indexOf(name);
                if (index < 0) {
                    throw new SyntaxError(`unknown variable "${name}". This option's variables are: ${names.join(', ')}.`);
                }
                return (args) => args[index];
            }
            case 'member': {
                const object = build(node.object);
                if (node.key.type === 'literal' && FORBIDDEN.has(String(node.key.value))) {
                    throw new SyntaxError(`"${node.key.value}" cannot be read.`);
                }
                const key = build(node.key);
                return (args) => read(object(args), key(args));
            }
            case 'call': {
                const fn = Object.prototype.hasOwnProperty.call(EXPR_FUNCTIONS, node.name) ? EXPR_FUNCTIONS[node.name] : null;
                if (!fn) {
                    throw new SyntaxError(`unknown function "${node.name}". The functions are: ${Object.keys(EXPR_FUNCTIONS).join(', ')}.`);
                }
                const items = node.args.map(build);
                return (args) => fn(...items.map((/** @type {(args: any[]) => any} */ item) => item(args)));
            }
            case 'unary': {
                const arg = build(node.arg);
                if (node.op === '!') return (args) => !arg(args);
                if (node.op === '-') return (args) => -arg(args);
                return (args) => +arg(args);
            }
            case 'binary': {
                const left = build(node.left);
                const right = build(node.right);
                if (node.op === '&&') return (args) => left(args) && right(args);
                if (node.op === '||') return (args) => left(args) || right(args);
                if (node.op === '??') return (args) => left(args) ?? right(args);
                const op = OPERATORS[node.op];
                return (args) => op(left(args), right(args));
            }
            case 'ternary': {
                const test = build(node.test);
                const yes = build(node.yes);
                const no = build(node.no);
                return (args) => (test(args) ? yes(args) : no(args));
            }
            case 'array': {
                const items = node.items.map(build);
                return (args) => items.map((/** @type {(args: any[]) => any} */ item) => item(args));
            }
            case 'object': {
                const entries = node.entries.map((/** @type {{ key: string, value: Node }} */ e) => {
                    if (FORBIDDEN.has(e.key)) throw new SyntaxError(`"${e.key}" cannot be a key.`);
                    return /** @type {[string, (args: any[]) => any]} */ ([e.key, build(e.value)]);
                });
                return (args) => Object.fromEntries(entries.map((/** @type {[string, (args: any[]) => any]} */ [k, v]) => [k, v(args)]));
            }
            default:
                throw new SyntaxError(`unknown node "${node.type}"`);
        }
    }

    const run = build(tree);
    return (...args) => run(args);
}

// ── From a JavaScript arrow to an expression ────────────────────────────────

/** @param {Node} node @param {number} [parent] the enclosing operator's precedence @returns {string} */
function print(node, parent = 0) {
    switch (node.type) {
        case 'literal':
            return typeof node.value === 'string' ? `'${node.value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'` : String(node.value);
        case 'name':
            return node.name;
        case 'member':
            return node.key.type === 'literal' && /^[A-Za-z_$][\w$]*$/.test(String(node.key.value))
                ? `${print(node.object, 99)}.${node.key.value}`
                : `${print(node.object, 99)}[${print(node.key)}]`;
        case 'call':
            return `${node.name}(${node.args.map((/** @type {Node} */ a) => print(a)).join(', ')})`;
        case 'unary':
            return `${node.op}${print(node.arg, 98)}`;
        case 'binary': {
            const prec = /** @type {number} */ (PRECEDENCE.get(node.op));
            const text = `${print(node.left, prec)} ${node.op === '===' ? '==' : node.op === '!==' ? '!=' : node.op} ${print(node.right, prec + 1)}`;
            return prec < parent ? `(${text})` : text;
        }
        case 'ternary': {
            const text = `${print(node.test, 1)} ? ${print(node.yes)} : ${print(node.no)}`;
            return parent > 0 ? `(${text})` : text;
        }
        case 'array':
            return `[${node.items.map((/** @type {Node} */ a) => print(a)).join(', ')}]`;
        case 'object':
            return `{ ${node.entries.map((/** @type {{ key: string, value: Node }} */ e) =>
                `${/^[A-Za-z_$][\w$]*$/.test(e.key) ? e.key : `'${e.key}'`}: ${print(e.value)}`).join(', ')} }`;
        default:
            throw new SyntaxError(`unknown node "${node.type}"`);
    }
}

/**
 * The `expr` that says what an arrow function says, or null when it has none: a
 * block body, a call, a template, a variable from outside, or a loose `==`.
 * @param {Function} fn
 * @param {string[] | string} params the option's signature (see `compileExpr`)
 * @returns {string | null}
 */
export function liftExpr(fn, params) {
    const source = Function.prototype.toString.call(fn).trim();
    const arrow = /^(?:\(([^()]*)\)|([A-Za-z_$][\w$]*))\s*=>\s*([\s\S]+)$/.exec(source);
    if (!arrow) return null;
    const body = arrow[3].trim();
    if (body.startsWith('{')) return null;

    /** @type {Map<string, string>} the arrow's own names -> the option's variables */
    const rename = new Map();
    const declared = (arrow[1] ?? arrow[2]).trim();
    if (Array.isArray(params)) {
        const own = declared ? declared.split(',').map((p) => p.trim()) : [];
        if (own.length > params.length || own.some((p) => !/^[A-Za-z_$][\w$]*$/.test(p))) return null;
        own.forEach((p, i) => rename.set(p, params[i]));
    } else if (declared) {
        // One context object: only `({ a, b }) => …` reads its keys by name.
        const keys = /^\{([^{}]*)\}$/.exec(declared);
        if (!keys) return null;
        const own = keys[1].split(',').map((p) => p.trim()).filter(Boolean);
        if (own.some((p) => !/^[A-Za-z_$][\w$]*$/.test(p))) return null;
        own.forEach((p) => rename.set(p, p));
    }

    let tree;
    try {
        tree = parseExpr(body);
    } catch {
        return null;
    }
    let liftable = true;
    /** @param {Node} node */
    const visit = (node) => {
        if (node.type === 'call') liftable = false;
        // In JavaScript `==` coerces; here it does not.
        if (node.type === 'binary' && (node.op === '==' || node.op === '!=')) liftable = false;
        if (node.type === 'name' && !(node.name in CONSTANTS)) {
            const to = rename.get(node.name);
            if (to === undefined) liftable = false;
            else node.name = to;
        }
        const children = node.type === 'object'
            ? node.entries.map((/** @type {{ value: Node }} */ e) => e.value)
            : Object.values(node).flat().filter((v) => v && typeof v === 'object' && typeof v.type === 'string');
        children.forEach(visit);
    };
    visit(tree);
    return liftable ? print(tree) : null;
}
