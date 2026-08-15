// gen-authoring-types — regenerate src/authoring/index.d.ts from the JSDoc.
//
// The authoring kit is 90 re-exports whose real signatures live as JSDoc on the
// source modules. Hand-writing declarations for them would drift immediately, and
// declaring the barrel as `typeof import('./index.js')` only types consumers who
// enable `allowJs` — a normal TypeScript consumer gets TS7016 instead.
//
// So: emit declarations for the whole import graph with tsc, then lift exactly the
// statements the barrel re-exports (plus every local type they depend on) into one
// self-contained .d.ts. Cross-module type references are collapsed to the inlined
// local names, and relative specifiers are re-based onto src/authoring/.
//
// Run:  node scripts/gen-authoring-types.mjs
// Then: npm run typecheck && npm run check:exports
import { execSync } from 'node:child_process';
import os from 'node:os';
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Emit declarations for the barrel's whole import graph into a scratch dir.
const DTS = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'elicit-dts-'));
if (!process.argv[2]) {
    execSync(
        `npx tsc --ignoreConfig --allowJs --declaration --emitDeclarationOnly ` +
        `--outDir ${DTS} --moduleResolution bundler --module esnext --target esnext ` +
        `--lib esnext,dom --skipLibCheck src/authoring/index.js`,
        { cwd: ROOT, stdio: 'inherit' },
    );
}

const barrel = fs.readFileSync(path.join(ROOT,'src/authoring/index.js'),'utf8');
const re = /export\s*\{([^}]*)\}\s*from\s*'([^']+)'/g;
const byMod = {}; let m;
while ((m = re.exec(barrel))) {
  const body = m[1].replace(/\/\/[^\n]*/g, '');
  const names = body.split(',').map(s=>s.trim()).filter(Boolean).map(s=>s.split(/\s+as\s+/)[0].trim());
  const mod = m[2].replace(/^\.\.\//,'').replace(/\.js$/,'');
  (byMod[mod] ||= []).push(...names);
}

// Re-base a relative specifier written in `fromMod`'s directory so it resolves
// from src/authoring/ instead. `../types` in src/plot/mark.js is `../types.js` here
// too, but `./projection.js` in src/core/tiles.js becomes `../core/projection.js`.
// Types defined in one source module and referenced from another arrive here as
// `import('../core/projection.js').ProjectionContext`. Every local type is already
// inlined above, so collapse those references to the bare name — otherwise a
// consumer without allowJs cannot resolve the .js module they point at.
const INLINED = ['ProjectionContext', 'ProjectionOptions', 'Tile', 'Driver'];
function collapseLocalRefs(text) {
  for (const n of INLINED) {
    text = text.replace(new RegExp(`import\\((['"])[^'"]+\\1\\)\\.${n}\\b`, 'g'), n);
  }
  return text;
}

function rebase(text, fromMod) {
  const fromDir = path.posix.dirname('src/' + fromMod);           // e.g. src/core
  return text.replace(/(from\s+|import\()\s*(['"])(\.[^'"]+)\2/g, (all, kw, q, spec) => {
    const abs = path.posix.normalize(path.posix.join(fromDir, spec));   // src/core/projection.js
    let rel = path.posix.relative('src/authoring', abs);
    if (!rel.startsWith('.')) rel = './' + rel;
    if (!rel.endsWith('.js')) rel += '.js';
    return `${kw}${q}${rel}${q}`;
  });
}

const out = [];
for (const [mod, names] of Object.entries(byMod)) {
  const file = path.join(DTS, mod + '.d.ts');
  if (!fs.existsSync(file)) { console.error('MISSING', file); continue; }
  const src = ts.createSourceFile(file, fs.readFileSync(file,'utf8'), ts.ScriptTarget.ESNext, true);
  const found = new Set();
  const types = [];   // local type/interface declarations the signatures depend on
  const values = [];
  for (const st of src.statements) {
    let declNames = [];
    let isType = false;
    if (ts.isFunctionDeclaration(st) && st.name) declNames = [st.name.text];
    else if (ts.isVariableStatement(st)) declNames = st.declarationList.declarations.map(d=>d.name.getText(src));
    else if (ts.isModuleDeclaration(st) && st.name) declNames = [st.name.getText(src)];
    else if (ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)) { declNames=[st.name.text]; isType = true; }
    else continue;
    const text = collapseLocalRefs(rebase(st.getFullText(src).trim(), mod));
    if (isType) {
      // Every local type comes along, exported as a type so the signatures resolve.
      const exported = (st.modifiers || []).some(mod => mod.kind === ts.SyntaxKind.ExportKeyword);
      types.push(exported ? text : text.replace(/^(\s*(?:\/\*[\s\S]*?\*\/\s*)?)/, '$1export '));
      continue;
    }
    const hit = declNames.filter(n => names.includes(n));
    if (!hit.length) continue;
    values.push(text);
    hit.forEach(n=>found.add(n));
  }
  if (types.length || values.length) out.push(`// ── from src/${mod}.js ${'─'.repeat(Math.max(0, 60 - mod.length))}`);
  out.push(...types, ...values);
  for (const n of names) if (!found.has(n)) console.error('NOT FOUND', mod, n);
}
const HEADER = `/**
 * Type declarations for the AUTHORING KIT — what you build new vocabulary FROM.
 *
 * Kept out of the grammar namespaces (\`plot.*\`, \`edit.*\`, \`constraints.*\`,
 * \`guides.*\`, \`elements.*\`, \`widgets.*\`), none of which may contain anything
 * that cannot appear in a spec. See src/authoring/index.js for what each group is
 * for.
 *
 * Reachable as \`elicit.authoring.*\` or \`import { … } from 'elicitjs/authoring'\`.
 *
 * GENERATED from the JSDoc on the source modules — do not edit by hand.
 * Regenerate with \`node scripts/gen-authoring-types.mjs\`; \`npm run check:exports\`
 * fails if it drifts from the runtime barrel.
 */
`;
const target = path.join(ROOT, 'src/authoring/index.d.ts');
fs.writeFileSync(target, HEADER + out.join('\n') + '\n');
console.log(`gen-authoring-types: wrote ${out.length} declarations to src/authoring/index.d.ts`);
