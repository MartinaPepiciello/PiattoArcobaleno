// Builds public/icon.svg and the PNG icons: a plate whose food is a rainbow of the nine categories.
// Run with `npm run icons` (needs sharp).
import { writeFileSync } from 'node:fs';
import sharp from 'sharp';

const COLORS = ['#d63f3a', '#ee8a3c', '#d6a91e', '#3a9d5a', '#14a0a0', '#2f7fd0', '#8a5fd0', '#e0609a', '#b8732a'];

function iconSVG({ rounded = false, scale = 1 } = {}) {
  const S = 512, cx = 256, cy = 256;
  const R = 200 * scale, rim = 168 * scale, food = 140 * scale;
  let wedges = '';
  const n = COLORS.length, gap = 0.035;
  COLORS.forEach((color, i) => {
    const a0 = (i / n) * 2 * Math.PI - Math.PI / 2 + gap / 2;
    const a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2 - gap / 2;
    const p = (a, r) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
    const r0 = 38 * scale;
    wedges += `<path d="M${p(a0, r0)} L${p(a0, food)} A${food} ${food} 0 0 1 ${p(a1, food)} L${p(a1, r0)} A${r0} ${r0} 0 0 0 ${p(a0, r0)}Z" fill="${color}"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">` +
    `<rect width="${S}" height="${S}" rx="${rounded ? 112 : 0}" fill="#faf6ef"/>` +
    `<ellipse cx="${cx}" cy="${cy + 14 * scale}" rx="${R}" ry="${R}" fill="#2b2723" opacity=".10"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${R}" fill="#ffffff" stroke="#e6ddcf" stroke-width="${4 * scale}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${rim}" fill="none" stroke="#efe7da" stroke-width="${5 * scale}"/>` +
    wedges +
    `<circle cx="${cx}" cy="${cy}" r="${26 * scale}" fill="#ffffff"/>` +
    `</svg>`;
}

writeFileSync('public/icon.svg', iconSVG({ rounded: true }));
const full = Buffer.from(iconSVG());
await sharp(full).resize(192, 192).png().toFile('public/icon-192.png');
await sharp(full).resize(512, 512).png().toFile('public/icon-512.png');
await sharp(full).resize(180, 180).png().toFile('public/apple-touch-icon.png');
await sharp(Buffer.from(iconSVG({ scale: 0.78 }))).resize(512, 512).png().toFile('public/icon-maskable-512.png');
console.log('icone create');
