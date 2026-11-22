// check-exports — the public surface must be typed, and the types must exist.
//
// `src/index.d.ts` is hand-maintained beside a `// @ts-check`-annotated source
// tree, so the two drift silently: at the time this gate was written the whole
// `edit.stack` namespace, `setWarnings`, `format.*` and `elements.AXIS_OPTIONS`
// were exported at runtime and absent from the declarations, which means a
// TypeScript consumer got an error on a documented API.
//
// It walks BOTH directions, because each failure mode is real:
//   runtime -> types   a shipped export nobody can call from TypeScript
//   types -> runtime   a declared export that doesn't exist (an `undefined` import)
//
// The declarations are read through the TypeScript compiler API rather than by
// regex: `plot: { bar(o?): Mark; … }` is a type literal, and the only thing that
// can be trusted to say what it contains is the checker.
//
// Run: npm run check:exports
import ts from 'typescript';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dtsPath = path.join(root, 'src/index.d.ts');

// Namespaces whose MEMBERS are checked one by one, not just the namespace itself.
// A namespace object is the grammar's vocabulary, so a missing member is a missing
// word — exactly the drift worth failing on.
const NAMESPACES = [
    'plot', 'elements', 'edit', 'constraints', 'guides', 'looks', 'layout', 'widgets', 'format',
    'authoring',
];

// Deliberately untyped-as-a-whole. `themes` is an open record of user themes; the
// value shape is what `Theme` pins down, not the key set.
const OPAQUE = new Set(['themes']);

/** @param {string} msg */
const fail = (msg) => { failures.push(msg); };
/** @type {string[]} */
const failures = [];

// ── What the declarations say ───────────────────────────────────────────────
// `allowJs` matters: the authoring kit is declared as
// `typeof import('./authoring/index.js')`, so its members come from the JSDoc on
// the JS itself — one declaration that cannot drift from the barrel. Without
// allowJs that type resolves to nothing and every member reads as missing.
const program = ts.createProgram([dtsPath], {
    noEmit: true,
    strict: true,
    allowJs: true,
    checkJs: false,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
});
const checker = program.getTypeChecker();
const source = program.getSourceFile(dtsPath);
if (!source) {
    console.error(`check-exports: cannot read ${dtsPath}`);
    process.exit(1);
}
const moduleSymbol = checker.getSymbolAtLocation(source);
if (!moduleSymbol) {
    console.error('check-exports: src/index.d.ts declares no module exports.');
    process.exit(1);
}

/** @type {Set<string>} */
const declaredTop = new Set(
    checker.getExportsOfModule(moduleSymbol).map((s) => s.getName()),
);

/**
 * The member names of a declared namespace object, read off its TYPE so that
 * `export const plot: { bar(…): Mark }` and an interface reference behave the same.
 * @param {string} name
 * @returns {Set<string> | null} null when the namespace is declared but opaque
 */
function declaredMembers(name) {
    const symbol = checker.getExportsOfModule(moduleSymbol).find((s) => s.getName() === name);
    if (!symbol) return new Set();
    const decl = symbol.valueDeclaration || symbol.declarations?.[0];
    if (!decl) return new Set();
    const type = checker.getTypeOfSymbolAtLocation(symbol, decl);
    const props = type.getProperties().map((p) => p.getName());
    // An index signature (`Record<string, any>`) accepts every name, so it can
    // never report drift. Treat it as untyped rather than as "everything is fine" —
    // that is precisely how `format` hid seven missing declarations.
    const hasIndex = !!checker.getIndexInfoOfType(type, ts.IndexKind.String);
    if (hasIndex && props.length === 0) return null;
    return new Set(props);
}

// ── What the runtime actually exports ───────────────────────────────────────
const runtime = await import(path.join(root, 'src/index.js'));

for (const name of Object.keys(runtime)) {
    if (name === 'default') continue;
    if (!declaredTop.has(name)) {
        fail(`runtime exports \`${name}\` but src/index.d.ts does not declare it.`);
    }
}
for (const name of declaredTop) {
    // Type-only exports (interfaces, type aliases) have no runtime counterpart.
    const symbol = checker.getExportsOfModule(moduleSymbol).find((s) => s.getName() === name);
    const isValue = !!(symbol && symbol.flags & (ts.SymbolFlags.Variable | ts.SymbolFlags.Function | ts.SymbolFlags.Class));
    if (!isValue) continue;
    if (!(name in runtime)) {
        fail(`src/index.d.ts declares \`${name}\` but the runtime does not export it.`);
    }
}

// Statics on an exported function (`Elicit.dataset`): the namespace loop below
// skips functions, so compare their own members here, both directions.
for (const [name, live] of Object.entries(runtime)) {
    if (typeof live !== 'function' || !declaredTop.has(name)) continue;
    const declared = declaredMembers(name);
    if (!declared) continue;
    for (const member of Object.keys(live)) {
        if (!declared.has(member)) fail(`runtime exports \`${name}.${member}\` but src/index.d.ts does not declare it.`);
    }
    for (const member of declared) {
        if (!(member in live)) fail(`src/index.d.ts declares \`${name}.${member}\` but the runtime does not export it.`);
    }
}
if (typeof runtime.Elicit?.dataset !== 'function') fail('`Elicit.dataset` is missing at runtime.');

for (const ns of NAMESPACES) {
    const live = runtime[ns];
    if (!live || typeof live !== 'object') continue;
    if (OPAQUE.has(ns)) continue;
    const declared = declaredMembers(ns);
    if (declared === null) {
        fail(`\`${ns}\` is declared as an open record in src/index.d.ts, so its ` +
            `${Object.keys(live).length} members are untyped. Declare them.`);
        continue;
    }
    for (const member of Object.keys(live)) {
        if (!declared.has(member)) {
            fail(`runtime exports \`${ns}.${member}\` but src/index.d.ts does not declare it.`);
        }
    }
    for (const member of declared) {
        if (!(member in live)) {
            fail(`src/index.d.ts declares \`${ns}.${member}\` but the runtime does not export it.`);
        }
    }
}

// ── Every factory's DECLARED options match the options it READS ─────────────
// src/vocabulary.js is what each factory validates its options against at run
// time; the per-factory interfaces in src/types.d.ts are what a TypeScript caller
// is allowed to pass. Both directions matter: an option typed but never read is a
// silent no-op with a green typecheck, and one read but never typed is an API
// nobody can call. `widgets`, `format` and `authoring` carry no vocabulary yet
// and are skipped; so is any member whose options parameter is not an object.
const vocab = await import(path.join(root, 'src/vocabulary.js'));
const { baseMark, baseElement } = vocab;
const VOCAB = {
    plot: { universal: [...vocab.MARK_UNIVERSAL_OPTIONS, ...vocab.MARK_SHORTHANDS], of: (m) => { const b = baseMark(m); return b ? vocab.MARK_OPTIONS[b] : null; } },
    elements: { universal: vocab.ELEMENT_UNIVERSAL_OPTIONS, of: (m) => { const b = baseElement(m); return b ? vocab.ELEMENT_OPTIONS[b] : null; } },
    guides: { universal: vocab.GUIDE_UNIVERSAL_OPTIONS, of: (m) => vocab.GUIDE_OPTIONS[m] || null },
    looks: { universal: vocab.LOOK_UNIVERSAL_OPTIONS, of: (m) => vocab.LOOK_OPTIONS[m] || null },
    layout: { universal: vocab.LAYOUT_UNIVERSAL_OPTIONS, of: (m) => vocab.LAYOUT_OPTIONS[m] || null },
    constraints: { universal: [], of: (m) => vocab.CONSTRAINT_OPTIONS[m] || null },
    edit: { universal: vocab.EDIT_UNIVERSAL_OPTIONS, of: (m) => vocab.EDIT_OPTIONS[m === 'scale.categories' ? 'scale.addCategory' : m] || null },
};

/**
 * The property names of a call signature's options parameter (the last parameter
 * whose type is an object with named properties), or null when there is none or
 * it is an open index signature.
 */
function declaredOptionNames(memberSymbol) {
    const decl = memberSymbol.valueDeclaration || memberSymbol.declarations?.[0];
    if (!decl) return { skip: 'no declaration' };
    const type = checker.getTypeOfSymbolAtLocation(memberSymbol, decl);
    const sig = type.getCallSignatures()[0];
    if (!sig) return { skip: 'not callable' };
    const params = sig.getParameters();
    for (let i = params.length - 1; i >= 0; i--) {
        const p = params[i];
        const pd = p.valueDeclaration || p.declarations?.[0];
        let pt = checker.getTypeOfSymbolAtLocation(p, pd);
        // `options?: X` arrives as X | undefined.
        if (pt.isUnion()) pt = pt.types.find((t) => !(t.flags & ts.TypeFlags.Undefined)) || pt;
        if (pt.getCallSignatures().length) continue; // a function argument (custom's apply)
        const props = pt.getProperties().map((q) => q.getName());
        if (checker.getIndexInfoOfType(pt, ts.IndexKind.String)) return { open: true, props };
        if (props.length) return { props };
    }
    return { skip: 'no options parameter' };
}

/** Walk a namespace type: yields [dotted.path, symbol] for every callable member. */
function* members(nsSymbol, prefix = '') {
    const decl = nsSymbol.valueDeclaration || nsSymbol.declarations?.[0];
    const type = checker.getTypeOfSymbolAtLocation(nsSymbol, decl);
    for (const p of type.getProperties()) {
        const pd = p.valueDeclaration || p.declarations?.[0];
        const pt = checker.getTypeOfSymbolAtLocation(p, pd);
        const name = prefix ? `${prefix}.${p.getName()}` : p.getName();
        if (pt.getCallSignatures().length) yield [name, p];
        else if (pt.getProperties().length) yield* members(p, name);
    }
}

let signaturesChecked = 0;
for (const ns of Object.keys(VOCAB)) {
    const nsSymbol = checker.getExportsOfModule(moduleSymbol).find((s) => s.getName() === ns);
    if (!nsSymbol) continue;
    const { universal, of } = VOCAB[ns];
    for (const [member, symbol] of members(nsSymbol)) {
        if (member === 'custom' || member === 'when' || member.startsWith('when.')) continue;
        const allow = of(member);
        if (!allow) continue; // no vocabulary entry: nothing to hold it to
        const got = declaredOptionNames(symbol);
        if (got.skip) continue;
        signaturesChecked += 1;
        if (got.open) {
            fail(`${ns}.${member}() is typed with an open options bag, so its ${allow.length} runtime options are untyped. Declare them.`);
            continue;
        }
        const known = new Set([...universal, ...allow]);
        const extra = got.props.filter((k) => !known.has(k));
        const missing = allow.filter((k) => !got.props.includes(k));
        if (extra.length) fail(`${ns}.${member}() is typed to accept ${extra.map((k) => `\`${k}\``).join(', ')}, which the factory never reads (src/vocabulary.js).`);
        if (missing.length) fail(`${ns}.${member}() reads ${missing.map((k) => `\`${k}\``).join(', ')} (src/vocabulary.js) but its options type does not declare ${missing.length > 1 ? 'them' : 'it'}.`);
    }
}

// ── Every scoped edit's `type` IS its dotted path ───────────────────────────
// `edit.line.draw()` <-> { "type": "line.draw" }. That has been the documented
// convention (edit/index.js, index.d.ts) far longer than it was true: only
// edit.legend.* actually spelled it that way, and the bare ones COLLIDED —
// edit.move/edit.geo.move and edit.create/edit.geo.create were indistinguishable
// by type, so a driver that claims edits by type alone (edit/drivers/move.js)
// silently took the wrong one. Nothing else can catch that: both edits typecheck,
// both render, and only the gesture misbehaves. So assert it here.
// The scoped families are the object-valued members of `edit` (the universal
// edits are functions; `when` is a bag of predicates, not edits).
const EDIT_FAMILIES = Object.entries(runtime.edit || {})
    .filter(([ns, v]) => ns !== 'when' && v && typeof v === 'object');

for (const [ns, family] of EDIT_FAMILIES) {
    for (const [member, factory] of Object.entries(family)) {
        if (typeof factory !== 'function') continue;
        let made;
        try { made = factory({}); } catch { continue; } // needs options; skipped
        for (const e of [made].flat(Infinity)) {
            if (!e || typeof e !== 'object' || typeof e.type !== 'string') continue;
            if (!e.type.startsWith(`${ns}.`)) {
                fail(`edit.${ns}.${member}() reports type "${e.type}", which does not ` +
                    `start with "${ns}." — a scoped edit's type must be its dotted path, ` +
                    `or it can collide with a same-named edit in another namespace.`);
            }
        }
    }
}

// ── The JSON grammar covers the declared surface ────────────────────────────
// `compile()` (src/json) turns `{ "type": "bar", … }` into `plot.bar({ … })`. It
// finds every factory by walking the namespaces, but three facts about a factory
// are not in its name, and each must be stated in src/vocabulary.js or the JSON
// form of that factory is silently wrong:
//   a positional argument           SPEC_POSITIONAL
//   an option that takes a function SPEC_FUNCTIONS (or a slot that takes one)
//   an option that holds a factory  SPEC_SLOTS
// So read them off the declarations and hold the tables to them.
const { ownersOf, signatureOf } = await import(path.join(root, 'src/json/compile.js'));
const FACTORY_RESULTS = new Set(['Mark', 'Edit', 'ConstraintSpec', 'Guide', 'ChartElement', 'Look', 'LayoutSpec']);

/** The types a declared type is made of: union members and array elements. */
function partsOf(type) {
    if (type.isUnion()) return type.types.flatMap(partsOf);
    if (checker.isArrayType(type)) return checker.getTypeArguments(type).flatMap(partsOf);
    return [type];
}
const isAny = (type) => !!(type.flags & ts.TypeFlags.Any);
const takesFunction = (type) => partsOf(type).some((t) => t.getCallSignatures().length > 0);
const holdsFactory = (type) => partsOf(type).some((t) => FACTORY_RESULTS.has((t.aliasSymbol || t.symbol)?.getName()));
const typeOf = (symbol) => checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration || symbol.declarations?.[0] || source);
/** An options bag: an object with named properties that is not itself callable. */
const isOptionsBag = (type) => partsOf(type).filter((t) => !(t.flags & ts.TypeFlags.Undefined))
    .every((t) => !!(t.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) && !t.getCallSignatures().length && !checker.isArrayType(t));

/** Hold one options type to the grammar tables. */
function checkOptionGrammar(label, optionsType, owners) {
    for (const t of partsOf(optionsType)) {
        for (const prop of t.getProperties()) {
            const name = prop.getName();
            const type = typeOf(prop);
            if (isAny(type) || vocab.SPEC_OPAQUE.includes(name)) continue;
            const slot = vocab.SPEC_SLOTS[name];
            if (holdsFactory(type) && !slot) {
                fail(`${label}: option \`${name}\` holds a factory result, so a JSON spec writes it as { "type": … }. Add it to SPEC_SLOTS (src/vocabulary.js).`);
            } else if (takesFunction(type) && !(slot && slot.fn) && !signatureOf(owners, name)) {
                fail(`${label}: option \`${name}\` takes a function, so a JSON spec writes it as { "fn" } or { "expr" }. Add its parameters to SPEC_FUNCTIONS (src/vocabulary.js).`);
            }
        }
    }
}

let grammarChecked = 0;
for (const ns of ['plot', 'elements', 'guides', 'looks', 'layout', 'constraints', 'edit', 'widgets', 'format']) {
    const nsSymbol = checker.getExportsOfModule(moduleSymbol).find((sym) => sym.getName() === ns);
    if (!nsSymbol) continue;
    for (const [member, symbol] of members(nsSymbol)) {
        if (ns === 'format' && member === 'resolveFormat') continue;
        const sig = typeOf(symbol).getCallSignatures()[0];
        if (!sig) continue;
        const params = sig.getParameters();
        const isWhen = ns === 'edit' && member.startsWith('when.');
        const key = isWhen ? member : `${ns}.${member}`;
        let positional;
        if (isWhen) {
            // A member that returns a predicate is called; one that IS a predicate is not.
            positional = sig.getReturnType().getCallSignatures().length ? params.map((q) => q.getName()) : [];
        } else if (ns === 'format') {
            positional = params.map((q) => q.getName());
        } else {
            const bag = params.findLastIndex((q) => isOptionsBag(typeOf(q)));
            positional = params.filter((_, i) => i !== bag).map((q) => q.getName());
            if (bag >= 0) checkOptionGrammar(`${key}()`, typeOf(params[bag]), ownersOf(ns, member));
        }
        grammarChecked += 1;
        const declaredPositional = vocab.SPEC_POSITIONAL[key] || [];
        if (positional.join(',') !== declaredPositional.join(',')) {
            fail(`${key}() takes the positional arguments [${positional.join(', ')}] but SPEC_POSITIONAL (src/vocabulary.js) says [${declaredPositional.join(', ')}], ` +
                `so its JSON descriptor would pass the wrong arguments.`);
        }
    }
}
for (const key of Object.keys(vocab.SPEC_POSITIONAL)) {
    const [ns, ...rest] = key.split('.');
    const live = rest.reduce((o, k) => (o ? o[k] : undefined), ns === 'when' ? runtime.edit.when : runtime[ns]);
    if (typeof live !== 'function') fail(`SPEC_POSITIONAL names \`${key}\`, which is not an exported factory.`);
}
// The spec's own keys (`lock`, `context`, `onChange`).
const specSymbol = checker.getExportsOfModule(moduleSymbol).find((sym) => sym.getName() === 'ElicitSpec');
if (specSymbol) checkOptionGrammar('ElicitSpec', checker.getDeclaredTypeOfSymbol(specSymbol), ['spec']);

if (failures.length) {
    console.error(`\ncheck-exports: ${failures.length} drift${failures.length === 1 ? '' : 's'} between the runtime and src/index.d.ts\n`);
    for (const f of failures) console.error(`  · ${f}`);
    console.error('');
    process.exit(1);
}

const counted = NAMESPACES
    .filter((ns) => runtime[ns] && typeof runtime[ns] === 'object')
    .map((ns) => `${ns}: ${Object.keys(runtime[ns]).length}`)
    .join(', ');
console.log(`check-exports: OK — ${declaredTop.size} top-level exports (${counted}); ${signaturesChecked} option signatures match src/vocabulary.js; ${grammarChecked} factories match the JSON grammar`);
