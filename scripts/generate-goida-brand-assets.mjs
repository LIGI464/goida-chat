/* global console, process */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { Resvg } from '@resvg/resvg-js';
import opentype from 'opentype.js';
import pngToIco from 'png-to-ico';

const rootDir = process.cwd();
const publicDir = path.join(rootDir, 'apps', 'web', 'public');
const brandDir = path.join(publicDir, 'brand');
const tmpDir = path.join(rootDir, '.tmp', 'goida-brand');

const soraFontPath = path.join(
  rootDir,
  'node_modules',
  '@fontsource',
  'sora',
  'files',
  'sora-latin-800-normal.woff',
);

const silverLight = ['#ffffff', '#dfe3e8', '#b6bcc5', '#eef1f5'];
const silverDark = ['#a0a3aa', '#64676d', '#34363b', '#7b7e84'];
const graphite = ['#1e1f22', '#111214'];

function arrayBufferFromBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function loadFont(fontPath) {
  const fontBuffer = await fs.readFile(fontPath);
  return opentype.parse(arrayBufferFromBuffer(fontBuffer));
}

function pathData(font, text, x, y, fontSize) {
  return font.getPath(text, x, y, fontSize, { kerning: true }).toPathData(3);
}

function advanceWidth(font, text, fontSize) {
  return font.getAdvanceWidth(text, fontSize, { kerning: true });
}

function defs() {
  return `
    <defs>
      <linearGradient id="panelFill" x1="72" y1="56" x2="440" y2="456" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="${graphite[0]}" />
        <stop offset="1" stop-color="${graphite[1]}" />
      </linearGradient>
      <linearGradient id="panelStroke" x1="92" y1="66" x2="426" y2="440" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#fbfbfc" stop-opacity="0.8" />
        <stop offset="0.42" stop-color="#e6e8ec" stop-opacity="0.38" />
        <stop offset="1" stop-color="#4c4e54" stop-opacity="0.85" />
      </linearGradient>
      <linearGradient id="silverLight" x1="128" y1="128" x2="388" y2="388" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="${silverLight[0]}" />
        <stop offset="0.3" stop-color="${silverLight[1]}" />
        <stop offset="0.6" stop-color="${silverLight[2]}" />
        <stop offset="1" stop-color="${silverLight[3]}" />
      </linearGradient>
      <linearGradient id="silverDark" x1="180" y1="112" x2="402" y2="372" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="${silverDark[0]}" />
        <stop offset="0.34" stop-color="${silverDark[1]}" />
        <stop offset="0.7" stop-color="${silverDark[2]}" />
        <stop offset="1" stop-color="${silverDark[3]}" />
      </linearGradient>
      <linearGradient id="wordGoida" x1="0" y1="0" x2="520" y2="0" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#ffffff" />
        <stop offset="0.25" stop-color="#ebedf1" />
        <stop offset="0.7" stop-color="#b9bec5" />
        <stop offset="1" stop-color="#f4f6fa" />
      </linearGradient>
      <linearGradient id="wordChat" x1="540" y1="0" x2="1080" y2="0" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#6f7278" />
        <stop offset="0.45" stop-color="#3c3e44" />
        <stop offset="1" stop-color="#8e9298" />
      </linearGradient>
      <filter id="softGlow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="12" result="blur" />
      </filter>
      <filter id="smallGlow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="5" result="blur" />
      </filter>
      <filter id="panelShadow" x="-40%" y="-40%" width="180%" height="180%">
        <feDropShadow dx="0" dy="22" stdDeviation="22" flood-color="#000000" flood-opacity="0.46" />
      </filter>
    </defs>
  `;
}

function markSymbol({ simplified = false } = {}) {
  const ringStroke = simplified ? 26 : 22;
  const sickleStroke = simplified ? 18 : 16;
  const hammerStroke = simplified ? 20 : 18;
  const bubbleGlowOpacity = simplified ? 0.22 : 0.3;
  const innerGlowOpacity = simplified ? 0.16 : 0.24;

  return `
    <g>
      <rect x="56" y="56" width="400" height="400" rx="88" fill="url(#panelFill)" filter="url(#panelShadow)" />
      <rect x="56" y="56" width="400" height="400" rx="88" fill="none" stroke="url(#panelStroke)" stroke-width="2.4" />
      <rect x="56" y="56" width="400" height="400" rx="88" fill="none" stroke="#fafbfd" stroke-width="1.6" opacity="0.36" filter="url(#softGlow)" />

      <g opacity="${bubbleGlowOpacity}" filter="url(#smallGlow)">
        <path d="M168 378 A134 134 0 1 1 364 363" fill="none" stroke="#ffffff" stroke-width="${ringStroke}" stroke-linecap="round" />
        <path d="M168 378 L148 424 L214 406" fill="none" stroke="#ffffff" stroke-width="${ringStroke}" stroke-linecap="round" stroke-linejoin="round" />
      </g>

      <g fill="none" stroke="url(#silverLight)" stroke-width="${ringStroke}" stroke-linecap="round" stroke-linejoin="round">
        <path d="M168 378 A134 134 0 1 1 364 363" />
        <path d="M168 378 L148 424 L214 406" />
      </g>

      <g opacity="${innerGlowOpacity}" filter="url(#smallGlow)">
        <path d="M281 187 A86 86 0 1 1 204 322" fill="none" stroke="#ffffff" stroke-width="${sickleStroke}" stroke-linecap="round" />
        <path d="M222 221 L321 323" fill="none" stroke="#ffffff" stroke-width="${hammerStroke}" stroke-linecap="round" />
        <path d="M194 234 L229 199 L268 209 L224 255 Z" fill="#ffffff" />
      </g>

      <path
        d="M281 187 A86 86 0 1 1 204 322"
        fill="none"
        stroke="url(#silverDark)"
        stroke-width="${sickleStroke}"
        stroke-linecap="round"
      />
      <path
        d="M222 221 L321 323"
        fill="none"
        stroke="url(#silverLight)"
        stroke-width="${hammerStroke}"
        stroke-linecap="round"
      />
      <path d="M194 234 L229 199 L268 209 L224 255 Z" fill="url(#silverLight)" />

      <g fill="url(#silverDark)">
        <circle cx="220" cy="388" r="11.5" />
        <circle cx="256" cy="388" r="11.5" />
        <circle cx="292" cy="388" r="11.5" />
      </g>
    </g>
  `;
}

function wrapSvg({ width, height, viewBox, content, background = 'transparent' }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="${viewBox}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="${background}" />
  ${defs()}
  ${content}
</svg>
`;
}

function buildMarkSvg() {
  return wrapSvg({
    width: 512,
    height: 512,
    viewBox: '0 0 512 512',
    content: markSymbol(),
  });
}

function buildFaviconSvg() {
  return wrapSvg({
    width: 64,
    height: 64,
    viewBox: '0 0 512 512',
    content: markSymbol({ simplified: true }),
  });
}

function buildWordmarkSvg(font) {
  const fontSize = 156;
  const goidaX = 24;
  const baselineY = 168;
  const goidaWidth = advanceWidth(font, 'Goida', fontSize);
  const chatX = goidaX + goidaWidth + 54;
  const goidaPath = pathData(font, 'Goida', goidaX, baselineY, fontSize);
  const chatPath = pathData(font, 'Chat', chatX, baselineY, fontSize);
  const content = `
    <g opacity="0.22" filter="url(#smallGlow)">
      <path d="${goidaPath}" fill="#ffffff" />
      <path d="${chatPath}" fill="#babdc2" />
    </g>
    <path d="${goidaPath}" fill="url(#wordGoida)" />
    <path d="${chatPath}" fill="url(#wordChat)" />
  `;

  return wrapSvg({
    width: 980,
    height: 232,
    viewBox: '0 0 980 232',
    content,
  });
}

function buildLockupSvg(font) {
  const fontSize = 136;
  const markX = 18;
  const markY = 18;
  const markScale = 0.36;
  const markSize = 512 * markScale;
  const wordX = markX + markSize + 28;
  const baselineY = 145;
  const goidaWidth = advanceWidth(font, 'Goida', fontSize);
  const chatX = wordX + goidaWidth + 42;
  const goidaPath = pathData(font, 'Goida', wordX, baselineY, fontSize);
  const chatPath = pathData(font, 'Chat', chatX, baselineY, fontSize);
  const content = `
    <g transform="translate(${markX} ${markY}) scale(${markScale})">
      ${markSymbol()}
    </g>
    <g opacity="0.2" filter="url(#smallGlow)">
      <path d="${goidaPath}" fill="#ffffff" />
      <path d="${chatPath}" fill="#b2b5ba" />
    </g>
    <path d="${goidaPath}" fill="url(#wordGoida)" />
    <path d="${chatPath}" fill="url(#wordChat)" />
  `;

  return wrapSvg({
    width: 892,
    height: 196,
    viewBox: '0 0 892 196',
    content,
  });
}

async function writeTextFile(filePath, contents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, 'utf8');
}

async function renderPng(svg, outputPath, width) {
  const resvg = new Resvg(svg, {
    fitTo: {
      mode: 'width',
      value: width,
    },
    background: 'rgba(0,0,0,0)',
    font: {
      fontFiles: [soraFontPath],
      loadSystemFonts: false,
    },
  });
  const pngBuffer = resvg.render().asPng();
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, pngBuffer);
}

async function main() {
  const font = await loadFont(soraFontPath);

  const markSvg = buildMarkSvg();
  const faviconSvg = buildFaviconSvg();
  const wordmarkSvg = buildWordmarkSvg(font);
  const lockupSvg = buildLockupSvg(font);

  await writeTextFile(path.join(brandDir, 'goida-mark.svg'), markSvg);
  await writeTextFile(path.join(brandDir, 'goida-wordmark.svg'), wordmarkSvg);
  await writeTextFile(path.join(brandDir, 'goida-lockup.svg'), lockupSvg);
  await writeTextFile(path.join(publicDir, 'favicon.svg'), faviconSvg);

  await renderPng(markSvg, path.join(publicDir, 'pwa-192.png'), 192);
  await renderPng(markSvg, path.join(publicDir, 'pwa-512.png'), 512);
  await renderPng(markSvg, path.join(publicDir, 'apple-touch-icon.png'), 180);
  await renderPng(markSvg, path.join(tmpDir, 'favicon-16.png'), 16);
  await renderPng(markSvg, path.join(tmpDir, 'favicon-32.png'), 32);
  await renderPng(markSvg, path.join(tmpDir, 'favicon-48.png'), 48);

  const favicon = await pngToIco([
    path.join(tmpDir, 'favicon-16.png'),
    path.join(tmpDir, 'favicon-32.png'),
    path.join(tmpDir, 'favicon-48.png'),
  ]);
  await fs.writeFile(path.join(publicDir, 'favicon.ico'), favicon);

  await fs.rm(tmpDir, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
