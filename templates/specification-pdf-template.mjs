import { createRequire } from 'node:module';
import { access, readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

const palette = {
  light: {
    paper: '#F3E8D5', surface: '#FCF5E8', soft: '#E9DCC4', ink: '#30271F',
    codeInk: '#241B14',
    muted: '#70604F', line: '#CBBB9F', accent: '#A33E25', accentInk: '#FFF8EC',
    cover: '#F3E8D5', coverSurface: '#E9DCC4', coverInk: '#30271F', watermark: '#D7C6A9',
    tableHead: '#30271F', tableHeadInk: '#FFF8EC',
  },
  dark: {
    paper: '#191C19', surface: '#232720', soft: '#2D3329', ink: '#ECE5D7',
    codeInk: '#F2EADC',
    muted: '#B7B5A3', line: '#505748', accent: '#F4A381', accentInk: '#241B14',
    cover: '#191C19', coverSurface: '#232720', coverInk: '#ECE5D7', watermark: '#393C35',
    tableHead: '#2D3329', tableHeadInk: '#ECE5D7',
  },
  print: {
    paper: '#FFFFFF', surface: '#F3F3F1', soft: '#EAE8E2', ink: '#25231F',
    codeInk: '#25231F',
    muted: '#5F5A52', line: '#D0CDC7', accent: '#A33E25', accentInk: '#FFFFFF',
    cover: '#FFFFFF', coverSurface: '#F7F5F1', coverInk: '#25231F', watermark: '#E4E1DC',
    tableHead: '#25231F', tableHeadInk: '#FFFFFF',
  },
};

export const THEMES = Object.keys(palette);
export const MM = 72 / 25.4;
export const PAGE_WIDTH = 210 * MM;
export const PAGE_HEIGHT = 297 * MM;
export const LEFT = 22 * MM;
export const RIGHT = PAGE_WIDTH - 20 * MM;
export const BOTTOM = 20 * MM;
export const TOP = PAGE_HEIGHT - 23 * MM;

export function colors(name) {
  const theme = palette[name];
  return Object.fromEntries(Object.entries(theme).map(([key, value]) => [key, color(value)]));
}

export function color(hex) {
  const value = hex.replace('#', '');
  return rgb(
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255,
  );
}

const fontCandidates = {
  body: [
    'C:/Windows/Fonts/segoeui.ttf',
    '/usr/share/fonts/truetype/ubuntu/Ubuntu-R.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  ],
  bold: [
    'C:/Windows/Fonts/segoeuib.ttf',
    '/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  ],
  italic: [
    'C:/Windows/Fonts/segoeuii.ttf',
    '/usr/share/fonts/truetype/ubuntu/Ubuntu-RI.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSans-Italic.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf',
  ],
  boldItalic: [
    'C:/Windows/Fonts/segoeuiz.ttf',
    '/usr/share/fonts/truetype/ubuntu/Ubuntu-BI.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSans-BoldItalic.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf',
  ],
  serif: [
    'C:/Windows/Fonts/pala.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
  ],
  serifBold: [
    'C:/Windows/Fonts/palab.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSerif-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf',
  ],
  code: [
    'C:/Windows/Fonts/consola.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationMono-Regular.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
  ],
};

async function findFont(name) {
  for (const candidate of fontCandidates[name]) {
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  throw new Error(`Cannot find a font for ${name}; expected a website-compatible system font`);
}

export async function embeddedFonts(document) {
  document.registerFontkit(fontkit);
  const fontBytes = await Promise.all(Object.keys(fontCandidates).map(async (name) => [
    name,
    await readFile(await findFont(name)),
  ]));
  const embedded = await Promise.all(fontBytes.map(async ([name, bytes]) => [
    name,
    await document.embedFont(bytes, { subset: true }),
  ]));
  const fonts = Object.fromEntries(embedded);
  fonts.serifBold ??= fonts.serif;
  return fonts;
}

export function drawCover(document, metadata, theme, fonts) {
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: theme.cover });

  const ornamentX = PAGE_WIDTH - 20 * MM;
  const ornamentY = 50 * MM;
  page.drawCircle({ x: ornamentX, y: ornamentY, size: 52 * MM, color: theme.coverSurface });
  page.drawCircle({ x: ornamentX, y: ornamentY, size: 43 * MM, borderColor: theme.watermark, borderWidth: 0.6 });
  page.drawCircle({ x: ornamentX, y: ornamentY, size: 34 * MM, borderColor: theme.watermark, borderWidth: 0.6 });

  const markSize = 58 * MM;
  const markX = PAGE_WIDTH - 74 * MM;
  const markY = 22 * MM;
  const weight = markSize * 0.09;
  const ringLeft = ornamentX - 34 * MM;
  const stemCenter = ringLeft + weight / 2;
  const stemBottom = markY + markSize * 0.18;
  const stemTop = markY + markSize * 0.82;
  page.drawLine({ start: { x: stemCenter, y: stemBottom }, end: { x: stemCenter, y: stemTop }, thickness: weight, color: theme.watermark });
  const joinX = ringLeft;
  page.drawLine({ start: { x: markX + markSize * 0.70, y: markY + markSize * 0.76 }, end: { x: joinX, y: markY + markSize * 0.50 }, thickness: weight, color: theme.watermark });
  page.drawLine({ start: { x: joinX, y: markY + markSize * 0.50 }, end: { x: markX + markSize * 0.70, y: markY + markSize * 0.24 }, thickness: weight, color: theme.watermark });

  const left = LEFT;
  let y = PAGE_HEIGHT - 184;
  const titleLines = metadata.title.replace(' Language ', ' Language\n').split('\n');
  for (const line of titleLines) {
    page.drawText(normalizeText(line), { x: left, y, size: 34, font: fonts.serifBold, color: theme.coverInk });
    y -= 43;
  }
  y -= 12;
  for (const [label, value] of [
    ['VERSION', metadata.version],
    ['STATUS', metadata.status.toUpperCase()],
    ['DATE', metadata.date],
    ['JAVA VERSION', metadata.javaversion],
  ]) {
    page.drawText(label, { x: left, y, size: 8.4, font: fonts.bold, color: theme.accent });
    page.drawText(normalizeText(value), { x: left + 82, y, size: 8.4, font: fonts.bold, color: theme.accent });
    y -= 16;
  }
  page.drawRectangle({ x: left, y: y - 13, width: 88, height: 2.3, color: theme.accent });
  return page;
}

export function drawPageChrome(page, metadata, theme, fonts, pageNumber) {
  const markX = LEFT;
  const markY = PAGE_HEIGHT - 34;
  const markSize = 15;
  page.drawRectangle({ x: markX, y: markY, width: markSize, height: markSize, color: theme.accent });
  page.drawLine({ start: { x: markX + 4.5, y: markY + 3.3 }, end: { x: markX + 4.5, y: markY + 11.7 }, thickness: 1.8, color: theme.accentInk });
  page.drawLine({ start: { x: markX + 11.1, y: markY + 11.2 }, end: { x: markX + 5.1, y: markY + 7.5 }, thickness: 1.8, color: theme.accentInk });
  page.drawLine({ start: { x: markX + 5.1, y: markY + 7.5 }, end: { x: markX + 11.1, y: markY + 3.8 }, thickness: 1.8, color: theme.accentInk });
  page.drawText('Kalm Language Specification', {
    x: markX + 21, y: PAGE_HEIGHT - 30, size: 8.2, font: fonts.bold, color: theme.accent,
  });
  const edition = `${metadata.version}  /  ${metadata.status.toUpperCase()}`;
  const editionWidth = fonts.bold.widthOfTextAtSize(edition, 7.5);
  page.drawText(edition, {
    x: RIGHT - editionWidth, y: PAGE_HEIGHT - 30, size: 7.5, font: fonts.bold, color: theme.accent,
  });

  page.drawText(metadata.date, { x: LEFT, y: 19, size: 7.5, font: fonts.body, color: theme.accent });
  const pageLabel = String(pageNumber).padStart(2, '0');
  const labelWidth = fonts.bold.widthOfTextAtSize(pageLabel, 7.1);
  page.drawText(pageLabel, {
    x: RIGHT - labelWidth,
    y: 19.1,
    size: 7.1,
    font: fonts.bold,
    color: theme.accent,
  });
}

export function normalizeText(value) {
  return String(value)
    .replaceAll('\u00a7', 'Section ')
    .replaceAll('\u00a0', ' ')
    .replaceAll('\u2010', '-')
    .replaceAll('\u2011', '-')
    .replaceAll('\u2012', '-')
    .replaceAll('\u2013', '-')
    .replaceAll('\u2014', '--')
    .replaceAll('\u2212', '-')
    .replaceAll('\u2018', "'")
    .replaceAll('\u2019', "'")
    .replaceAll('\u201c', '"')
    .replaceAll('\u201d', '"')
    .replaceAll('\u2026', '...')
    .replaceAll('\u2192', '->')
    .replaceAll('\u2190', '<-')
    .replaceAll('\u2194', '<->')
    .replaceAll('\u2264', '<=')
    .replaceAll('\u2265', '>=')
    .replaceAll('\u2260', '!=')
    .replaceAll('\u00d7', 'x')
    .replaceAll('\u00b7', ' / ')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\x20-\x7E\n\t]/g, '?');
}
