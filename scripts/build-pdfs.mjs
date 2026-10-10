#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import frontMatter from '../frontmatter.cjs';
import {
  BOTTOM, LEFT, PAGE_HEIGHT, PAGE_WIDTH, RIGHT, TOP,
  color, colors, drawCover, drawPageChrome, embeddedFonts, normalizeText,
} from '../templates/specification-pdf-template.mjs';

const require = createRequire(import.meta.url);
const { marked } = require('marked');
const { PDFDocument } = require('pdf-lib');
const { parseFrontMatter } = frontMatter;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const themes = ['light', 'dark', 'print'];
const CONTENT_BOTTOM = BOTTOM + 15;
const BODY_SIZE = 9.5;
const BODY_LEADING = 14;

function parseArguments(args) {
  const options = { outputDir: path.join(root, 'output', 'pdf'), theme: 'all' };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--output-dir') options.outputDir = path.resolve(args[++index] ?? '');
    else if (args[index] === '--theme') options.theme = args[++index] ?? '';
    else throw new Error(`Unknown option: ${args[index]}`);
  }
  if (options.theme !== 'all' && !themes.includes(options.theme)) {
    throw new Error(`Unsupported theme ${options.theme}; choose all, light, dark, or print`);
  }
  return options;
}

function headingSlug(line) {
  const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
  if (!match) return undefined;
  return match[2].replace(/[`*_~]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}_\- ]/gu, '').trim().replace(/\s+/g, '-');
}

function splitAtMain(markdown, source) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const closingFrontMatter = lines.indexOf('---', 1);
  if (closingFrontMatter < 0) throw new Error(`${source} has unclosed front matter`);
  const marker = lines.slice(closingFrontMatter + 1).find((line) => line.startsWith('[main]:'));
  const anchor = /^\[main\]:\s*<?#([^\s>]+)>?\s*$/.exec(marker ?? '')?.[1]?.toLowerCase();
  if (!anchor) throw new Error(`${source} must define a [main] heading anchor`);
  const start = lines.findIndex((line, index) => index > closingFrontMatter && headingSlug(line) === anchor);
  if (start < 0) throw new Error(`[main] anchor '#${anchor}' does not match a heading in ${source}`);
  return lines.slice(start).join('\n');
}

function textOf(tokens = []) {
  return tokens.map((token) => {
    if (token.type === 'text' || token.type === 'codespan' || token.type === 'escape') return token.text ?? '';
    if (token.type === 'br') return '\n';
    if (token.tokens) return textOf(token.tokens);
    return token.raw ?? '';
  }).join('');
}

function inlineRuns(tokens = [], style = {}) {
  const runs = [];
  for (const token of tokens) {
    if (token.type === 'strong') runs.push(...inlineRuns(token.tokens, { ...style, bold: true }));
    else if (token.type === 'em') runs.push(...inlineRuns(token.tokens, { ...style, italic: true }));
    else if (token.type === 'del') runs.push(...inlineRuns(token.tokens, { ...style, strike: true }));
    else if (token.type === 'link') runs.push(...inlineRuns(token.tokens, { ...style, link: token.href }));
    else if (token.type === 'br') runs.push({ ...style, text: '\n' });
    else if (token.type === 'codespan') runs.push({ ...style, code: true, text: token.text });
    else if (token.type === 'text' && token.tokens) runs.push(...inlineRuns(token.tokens, style));
    else if (['text', 'escape', 'html'].includes(token.type)) runs.push({ ...style, text: token.text ?? token.raw ?? '' });
  }
  return runs.filter((run) => run.text);
}

function fontFor(fonts, run) {
  if (run.code) return fonts.code;
  if (run.bold && run.italic) return fonts.boldItalic;
  if (run.bold) return fonts.bold;
  if (run.italic) return fonts.italic;
  return fonts.body;
}

function splitLongWord(word, font, size, maxWidth) {
  const parts = [];
  let part = '';
  for (const char of word) {
    if (part && font.widthOfTextAtSize(part + char, size) > maxWidth) {
      parts.push(part);
      part = char;
    } else part += char;
  }
  if (part) parts.push(part);
  return parts;
}

function wrapRuns(runs, width, size, fonts) {
  const lines = [[]];
  let lineWidth = 0;
  for (const run of runs) {
    const font = fontFor(fonts, run);
    const normalized = normalizeText(run.text);
    const chunks = normalized.split(/(\s+)/).filter(Boolean);
    for (let chunk of chunks) {
      if (chunk.includes('\n')) {
        const pieces = chunk.split('\n');
        pieces.forEach((piece, index) => {
          if (piece) addPiece(piece);
          if (index < pieces.length - 1) { lines.push([]); lineWidth = 0; }
        });
        continue;
      }
      if (!/^\s+$/.test(chunk) && font.widthOfTextAtSize(chunk, size) > width) {
        for (const piece of splitLongWord(chunk, font, size, width)) addPiece(piece);
      } else addPiece(chunk);
    }
    function addPiece(piece) {
      const pieceWidth = font.widthOfTextAtSize(piece, size);
      if (lineWidth && lineWidth + pieceWidth > width && !/^\s+$/.test(piece)) {
        lines.push([]);
        lineWidth = 0;
      }
      if (lines.at(-1).length === 0 && /^\s+$/.test(piece)) return;
      lines.at(-1).push({ ...run, text: piece });
      lineWidth += pieceWidth;
    }
  }
  return lines;
}

function createFlow(document, metadata, theme, fonts) {
  let page;
  let y;
  let pageNumber = 0;
  function newPage() {
    page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: theme.paper });
    pageNumber += 1;
    drawPageChrome(page, metadata, theme, fonts, pageNumber);
    y = TOP - 17;
  }
  function ensure(height) {
    if (!page || y - height < CONTENT_BOTTOM) newPage();
  }
  function drawTextLine(line, x, baseline, size, options = {}) {
    let cursorX = x;
    for (const run of line) {
      const font = fontFor(fonts, run);
      const runColor = run.link ? theme.accent : (options.color ?? theme.ink);
      page.drawText(normalizeText(run.text), { x: cursorX, y: baseline, size, font, color: runColor });
      const width = font.widthOfTextAtSize(normalizeText(run.text), size);
      if (run.link) page.drawLine({ start: { x: cursorX, y: baseline - 1.5 }, end: { x: cursorX + width, y: baseline - 1.5 }, thickness: 0.4, color: theme.accent });
      if (run.strike) page.drawLine({ start: { x: cursorX, y: baseline + size * 0.32 }, end: { x: cursorX + width, y: baseline + size * 0.32 }, thickness: 0.45, color: runColor });
      cursorX += width;
    }
  }
  function drawRuns(runs, { x = LEFT, width = RIGHT - LEFT, size = BODY_SIZE, leading = BODY_LEADING, color: ink } = {}) {
    const lines = wrapRuns(runs, width, size, fonts);
    for (const line of lines) {
      ensure(leading);
      drawTextLine(line, x, y - size, size, { color: ink });
      y -= leading;
    }
  }
  function gap(value) { y -= value; }
  function getPage() { return page; }
  function getY() { return y; }
  function setY(value) { y = value; }
  return { newPage, ensure, drawTextLine, drawRuns, gap, getPage, getY, setY, fonts, theme };
}

function tocTokens(tokens) {
  const result = [];
  for (const token of tokens) {
    if (token.type === 'heading' && token.depth > 1 && token.depth < 5) {
      result.push({ depth: token.depth, text: textOf(token.tokens) });
    }
  }
  return result;
}

function drawToc(flow, entries) {
  flow.newPage();
  flow.drawRuns([{ text: 'Contents', bold: true }], { size: 24, leading: 31, color: flow.theme.accent });
  flow.gap(14);
  for (const entry of entries) {
    const prefix = '-  ';
    const indent = (entry.depth - 2) * 15;
    flow.drawRuns([{ text: prefix + entry.text }], { x: LEFT + indent, width: RIGHT - LEFT - indent, size: entry.depth === 2 ? 10 : 8.8, leading: 16 });
  }
  flow.gap(10);
}

function drawParagraph(flow, token, options = {}) {
  const runs = inlineRuns(token.tokens);
  if (options.italic) runs.forEach((run) => { run.italic = true; });
  flow.drawRuns(runs, options);
  flow.gap(options.after ?? 7);
}

function drawCode(flow, token) {
  const rawLines = normalizeText(token.text).replace(/\n$/, '').split('\n');
  const size = 8.1;
  const leading = 11.5;
  const innerX = LEFT + 12;
  const available = RIGHT - innerX - 10;
  const codeLines = [];
  for (const sourceLine of rawLines) {
    if (!sourceLine) { codeLines.push(''); continue; }
    const words = sourceLine.split(/(\s+)/).filter(Boolean);
    let current = '';
    for (const word of words) {
      if (current && flow.fonts.code.widthOfTextAtSize(current + word, size) > available) {
        codeLines.push(current); current = word.trimStart();
      } else current += word;
    }
    codeLines.push(current);
  }
  const language = (token.lang ?? '').split(/[\s,]/)[0].toUpperCase();
  let index = 0;
  while (index < codeLines.length) {
    const labelHeight = language ? 19 : 10;
    flow.ensure(labelHeight + leading);
    const maxRows = Math.max(1, Math.floor((flow.getY() - CONTENT_BOTTOM - labelHeight - 10) / leading));
    const chunk = codeLines.slice(index, index + maxRows);
    const height = labelHeight + chunk.length * leading + 9;
    const top = flow.getY();
    const page = flow.getPage();
    page.drawRectangle({ x: LEFT, y: top - height, width: RIGHT - LEFT, height, color: flow.theme.surface });
    page.drawRectangle({ x: LEFT, y: top - height, width: 3, height, color: flow.theme.accent });
    if (language) page.drawText(language, { x: innerX, y: top - 12, size: 6.2, font: flow.fonts.bold, color: flow.theme.accent });
    chunk.forEach((line, row) => page.drawText(line, {
      x: innerX, y: top - labelHeight - 7 - row * leading, size: size + 0.4, font: flow.fonts.code, color: flow.theme.codeInk,
    }));
    flow.setY(top - height - 8);
    index += chunk.length;
    if (index < codeLines.length) flow.newPage();
  }
  flow.gap(7);
}

function drawList(flow, token, level = 0) {
  const base = Number(token.start) || 1;
  const itemX = LEFT + level * 12;
  const bodyX = itemX + 18;
  const bodyWidth = RIGHT - bodyX;
  token.items.forEach((item, index) => {
    const marker = item.task ? (item.checked ? '[x]' : '[ ]') : token.ordered ? `${base + index}.` : '-';
    const itemTokens = item.tokens ?? [];
    let markerPending = true;
    const drawItemText = (runs) => {
      if (markerPending) {
        flow.ensure(BODY_LEADING);
        flow.drawTextLine([{ text: marker }], itemX, flow.getY() - BODY_SIZE, BODY_SIZE);
        markerPending = false;
      }
      flow.drawRuns(runs, { x: bodyX, width: bodyWidth, size: BODY_SIZE, leading: BODY_LEADING });
    };

    for (const part of itemTokens) {
      if (part.type === 'text' || part.type === 'paragraph') {
        drawItemText(inlineRuns(part.tokens ?? [{ type: 'text', text: part.text ?? '' }]));
        if (part.type === 'paragraph') flow.gap(2);
      } else if (part.type === 'list') {
        if (markerPending) {
          flow.ensure(BODY_LEADING);
          flow.drawTextLine([{ text: marker }], itemX, flow.getY() - BODY_SIZE, BODY_SIZE);
          flow.gap(BODY_LEADING);
          markerPending = false;
        }
        drawList(flow, part, level + 1);
      } else {
        if (markerPending) {
          flow.ensure(BODY_LEADING);
          flow.drawTextLine([{ text: marker }], itemX, flow.getY() - BODY_SIZE, BODY_SIZE);
          flow.gap(BODY_LEADING);
          markerPending = false;
        }
        renderTokens(flow, [part]);
      }
    }
    if (markerPending) {
      flow.ensure(BODY_LEADING);
      flow.drawTextLine([{ text: marker }], itemX, flow.getY() - BODY_SIZE, BODY_SIZE);
      flow.gap(BODY_LEADING);
    }
    flow.gap(2);
  });
  flow.gap(3);
}

function drawTable(flow, token) {
  const rows = [token.header, ...token.rows];
  const columnCount = Math.max(1, token.header.length);
  const widths = Array(columnCount).fill((RIGHT - LEFT) / columnCount);
  const fontSize = 7.8;
  const lineHeight = 10;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const rowRuns = row.map((cell) => inlineRuns(cell.tokens ?? [{ type: 'text', text: cell.text ?? '' }]).map((run) => ({ ...run, bold: rowIndex === 0 || run.bold })));
    const wrapped = rowRuns.map((runs, column) => wrapRuns(runs, widths[column] - 12, fontSize, flow.fonts));
    const rowHeight = Math.max(25, ...wrapped.map((lines) => lines.length * lineHeight + 12));
    flow.ensure(rowHeight);
    const yTop = flow.getY();
    let x = LEFT;
    for (let column = 0; column < columnCount; column += 1) {
      const isHead = rowIndex === 0;
      const fill = isHead ? flow.theme.tableHead : (rowIndex % 2 === 0 ? flow.theme.soft : flow.theme.paper);
      flow.getPage().drawRectangle({ x, y: yTop - rowHeight, width: widths[column], height: rowHeight, color: fill, borderColor: flow.theme.line, borderWidth: 0.6 });
      let lineY = yTop - 9;
      for (const line of wrapped[column]) {
        flow.drawTextLine(line, x + 6, lineY - fontSize, fontSize, { color: isHead ? flow.theme.tableHeadInk : undefined });
        lineY -= lineHeight;
      }
      x += widths[column];
    }
    flow.setY(yTop - rowHeight);
  }
  flow.gap(9);
}

function drawBlockquote(flow, token) {
  const runs = [];
  for (const child of token.tokens ?? []) {
    if (child.type === 'paragraph') runs.push(...inlineRuns(child.tokens).map((run) => ({ ...run, italic: true })));
    else if (child.type === 'text') runs.push({ text: child.text, italic: true });
  }
  const lines = wrapRuns(runs, RIGHT - LEFT - 26, 9.2, flow.fonts);
  const height = lines.length * 14 + 14;
  flow.ensure(height);
  const top = flow.getY();
  flow.getPage().drawRectangle({ x: LEFT, y: top - height, width: RIGHT - LEFT, height, color: flow.theme.surface, borderColor: flow.theme.line, borderWidth: 0.6 });
  flow.getPage().drawRectangle({ x: LEFT, y: top - height, width: 3, height, color: flow.theme.accent });
  lines.forEach((line, index) => flow.drawTextLine(line, LEFT + 13, top - 10 - index * 14, 9.2));
  flow.setY(top - height - 8);
}

function renderTokens(flow, tokens) {
  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        if (token.depth === 1) break;
        const size = token.depth === 2 ? 17 : token.depth === 3 ? 12.5 : 10.5;
        flow.gap(token.depth === 2 ? 10 : 6);
        flow.drawRuns([{ text: textOf(token.tokens), bold: true }], { size, leading: size + 2.2, color: token.depth === 2 ? flow.theme.accent : flow.theme.ink });
        flow.gap(token.depth === 2 ? 4 : 3);
        break;
      }
      case 'paragraph': drawParagraph(flow, token); break;
      case 'code': drawCode(flow, token); break;
      case 'list': drawList(flow, token); break;
      case 'table': drawTable(flow, token); break;
      case 'blockquote': drawBlockquote(flow, token); break;
      case 'hr': {
        flow.gap(4);
        flow.ensure(12);
        flow.getPage().drawLine({ start: { x: LEFT, y: flow.getY() }, end: { x: RIGHT, y: flow.getY() }, thickness: 0.5, color: flow.theme.line });
        flow.gap(12);
        break;
      }
      default: break;
    }
  }
}

async function buildPdf(source, outputPath, themeName) {
  const markdown = await readFile(source, 'utf8');
  const metadata = parseFrontMatter(markdown, path.relative(root, source));
  const tokens = marked.lexer(splitAtMain(markdown, source), { gfm: true });
  const document = await PDFDocument.create();
  document.setTitle(`${metadata.title} ${metadata.version}`);
  document.setAuthor('Kalm language project');
  document.setSubject(`Kalm ${metadata.version} language specification (${metadata.status})`);
  const fonts = await embeddedFonts(document);
  const theme = colors(themeName);
  drawCover(document, metadata, theme, fonts);
  const flow = createFlow(document, metadata, theme, fonts);
  drawToc(flow, tocTokens(tokens));
  renderTokens(flow, tokens);
  await writeFile(outputPath, await document.save());
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const documentsDir = path.join(root, 'documents');
  const sources = (await readdir(documentsDir)).filter((name) => name.endsWith('.md')).sort()
    .map((name) => path.join(documentsDir, name));
  if (!sources.length) throw new Error(`No Markdown documents found in ${documentsDir}`);
  await mkdir(options.outputDir, { recursive: true });
  const selectedThemes = options.theme === 'all' ? themes : [options.theme];
  for (const source of sources) {
    for (const themeName of selectedThemes) {
      const outputPath = path.join(options.outputDir, `${path.parse(source).name}-${themeName}.pdf`);
      await buildPdf(source, outputPath, themeName);
      console.log(`Generated ${path.relative(root, outputPath)}`);
    }
  }
  console.log(`Generated ${sources.length * selectedThemes.length} specification PDFs in ${options.outputDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
