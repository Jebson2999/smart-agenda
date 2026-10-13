// Build do ASTRAL Smart Agenda: servidor (Node) + aplicativo (React) + CSS (Tailwind v4) + PWA.
// Uso: node scripts/build.mjs [--watch]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { compile } from 'tailwindcss';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const pub = path.join(dist, 'public');
const watch = process.argv.includes('--watch');
const twBase = path.dirname(fileURLToPath(import.meta.resolve('tailwindcss/package.json')));

function walk(dir, exts, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => f.name.endsWith(e))) out.push(p);
  }
  return out;
}

async function buildCss() {
  const input = fs.readFileSync(path.join(root, 'src/client/styles.css'), 'utf8');
  const compiler = await compile(input, {
    base: path.join(root, 'src/client'),
    loadStylesheet: async (id, base) => {
      let file;
      if (id === 'tailwindcss') file = path.join(twBase, 'index.css');
      else if (id.startsWith('tailwindcss/')) file = path.join(twBase, id.slice('tailwindcss/'.length));
      else file = path.resolve(base, id);
      return { path: file, base: path.dirname(file), content: fs.readFileSync(file, 'utf8') };
    },
  });
  // Extração de candidatos (equivalente ao scanner do Tailwind)
  const candidates = new Set();
  for (const f of walk(path.join(root, 'src/client'), ['.tsx', '.ts'])) {
    for (const tok of fs.readFileSync(f, 'utf8').split(/[\s"'`{}();,<>\\]+/)) if (tok && tok.length < 120) candidates.add(tok);
  }
  const css = compiler.build([...candidates]);
  const min = await esbuild.transform(css, { loader: 'css', minify: true });
  return min.code;
}

function hash(s) {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 10);
}

async function buildClient() {
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'src/client/main.tsx')],
    bundle: true,
    minify: true,
    sourcemap: false,
    format: 'esm',
    target: ['es2020', 'chrome90', 'safari15', 'firefox90'],
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    write: false,
    logLevel: 'warning',
    legalComments: 'none',
  });
  return result.outputFiles[0].text;
}

async function buildServer() {
  await esbuild.build({
    entryPoints: [path.join(root, 'src/server/index.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile: path.join(dist, 'server.mjs'),
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    logLevel: 'warning',
    legalComments: 'none',
  });
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, f.name);
    const d = path.join(dst, f.name);
    if (f.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

async function buildAll() {
  const t0 = Date.now();
  fs.rmSync(pub, { recursive: true, force: true });
  fs.mkdirSync(path.join(pub, 'assets'), { recursive: true });
  copyDir(path.join(root, 'public'), pub);
  const [js, css] = await Promise.all([buildClient(), buildCss()]);
  const jsName = `app-${hash(js)}.js`;
  const cssName = `app-${hash(css)}.css`;
  fs.writeFileSync(path.join(pub, 'assets', jsName), js);
  fs.writeFileSync(path.join(pub, 'assets', cssName), css);
  // Versões pré-comprimidas (o servidor entrega quando o navegador aceita gzip).
  for (const n of [jsName, cssName]) fs.writeFileSync(path.join(pub, 'assets', `${n}.gz`), zlib.gzipSync(fs.readFileSync(path.join(pub, 'assets', n)), { level: 9 }));
  const html = fs.readFileSync(path.join(root, 'src/client/index.html'), 'utf8').replace('%APP_JS%', `/assets/${jsName}`).replace('%APP_CSS%', `/assets/${cssName}`);
  fs.writeFileSync(path.join(pub, 'index.html'), html);
  const version = hash(js + css);
  const sw = fs.readFileSync(path.join(root, 'src/client/sw.js'), 'utf8').replace('%VERSION%', version).replace('%PRECACHE%', JSON.stringify(['/', '/offline.html', `/assets/${jsName}`, `/assets/${cssName}`, '/manifest.webmanifest', '/icons/icon-192.png', '/fonts/inter-400.woff', '/fonts/inter-500.woff', '/fonts/inter-600.woff', '/fonts/inter-700.woff']));
  fs.writeFileSync(path.join(pub, 'sw.js'), sw);
  await buildServer();
  console.log(`build ok em ${Date.now() - t0} ms — ${jsName} (${(js.length / 1024).toFixed(0)} KB), ${cssName} (${(css.length / 1024).toFixed(0)} KB)`);
}

await buildAll();

if (watch) {
  let child = null;
  const start = () => {
    child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(dist, 'server.mjs')], { stdio: 'inherit', env: process.env });
  };
  start();
  let pending = null;
  fs.watch(path.join(root, 'src'), { recursive: true }, () => {
    clearTimeout(pending);
    pending = setTimeout(async () => {
      try {
        await buildAll();
        child?.kill();
        start();
      } catch (e) {
        console.error(e.message);
      }
    }, 250);
  });
}
