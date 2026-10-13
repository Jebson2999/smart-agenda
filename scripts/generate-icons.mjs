// Gera os ícones do aplicativo (PWA, favicon, Apple) a partir do SVG da marca.
// Uso: node scripts/generate-icons.mjs   (requer o pacote "sharp")
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'icons');
fs.mkdirSync(out, { recursive: true });

// Marca: calendário com folha (saúde ambiental), sobre o verde institucional.
const mark = (inner = 1) => `
  <g transform="translate(${24 - 24 * inner} ${24 - 24 * inner}) scale(${inner})">
    <path d="M14 17.5h20a2.5 2.5 0 0 1 2.5 2.5v13a2.5 2.5 0 0 1-2.5 2.5H14a2.5 2.5 0 0 1-2.5-2.5V20a2.5 2.5 0 0 1 2.5-2.5Z" fill="none" stroke="#D6F4E7" stroke-width="2.2"/>
    <path d="M18 14v6M30 14v6" stroke="#D6F4E7" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M19 31c0-5.5 4.2-8.7 10.5-9.2-.3 6.2-3.6 9.9-8.6 10.1" fill="#3ED19A"/>
    <path d="M19 31.6c2.2-2.6 4.6-4.4 7.4-5.6" stroke="#0B4336" stroke-width="1.4" stroke-linecap="round"/>
  </g>`;

const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="13" fill="#0B4336"/>${mark(1)}</svg>`;
// Ícone "maskable": fundo cheio e marca dentro da área segura (80%).
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="#0B4336"/>${mark(0.72)}</svg>`;
// Apple: quadrado cheio (o iOS aplica o arredondamento).
const apple = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="#0B4336"/>${mark(0.86)}</svg>`;

fs.writeFileSync(path.join(out, 'favicon.svg'), rounded);
const jobs = [
  [rounded, 'favicon-32.png', 32],
  [rounded, 'icon-192.png', 192],
  [rounded, 'icon-512.png', 512],
  [maskable, 'icon-maskable-512.png', 512],
  [apple, 'apple-touch-icon.png', 180],
];
for (const [svg, name, size] of jobs) {
  await sharp(Buffer.from(svg), { density: 1200 }).resize(size, size).png().toFile(path.join(out, name));
  console.log('ícone', name, `${size}px`);
}
