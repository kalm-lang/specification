#!/usr/bin/env node
import {mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import frontMatter from '../frontmatter.cjs';
import {chooseCodeCount, chooseLineCount, tableColumnWidths, wrapCode} from './pdf-layout.mjs';
import {codeRuns, highlightCodeBlocks} from './code-highlighting.mjs';
import {
  BOTTOM,
  color,
  colors,
  drawCover,
  drawPageChrome,
  embeddedFonts,
  LEFT,
  normalizeText,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  RIGHT,
  TOP,
} from '../templates/specification-pdf-template.mjs';

const require = createRequire(import.meta.url);
const {marked} = require('marked');
const {PDFDocument, PDFName} = require('pdf-lib');
const {parseFrontMatter} = frontMatter;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const themes = ['light', 'dark', 'print'];
const CONTENT_BOTTOM = BOTTOM + 15;
const BODY_SIZE = 9.5;
const BODY_LEADING = 14;
const CONTENT_TOP = TOP - 17;
const CONTENT_HEIGHT = CONTENT_TOP - CONTENT_BOTTOM;
const CODE_SIZE = 8.5;
const CODE_LEADING = 11.5;
const CODE_LABEL_HEIGHT = 19;
const CODE_PADDING = 10;

function parseArguments(args) {
    const options = {outputDir: path.join(root, 'generated', 'pdf'), theme: 'all', all: false};
    for (let index = 0; index < args.length; index += 1) {
        if (args[index] === '--output-dir') options.outputDir = path.resolve(args[++index] ?? '');
        else if (args[index] === '--theme') options.theme = args[++index] ?? '';
        else if (args[index] === '--version') {
            options.version = args[++index] ?? '';
            if (!options.version || options.version.startsWith('--')) throw new Error('--version requires an X.Y.Z value, optionally followed by -status');
        } else if (args[index] === '--all') options.all = true;
        else throw new Error(`Unknown option: ${args[index]}`);
    }
    if (options.all && options.version) throw new Error('Use either --all or --version, not both');
    if (options.version && !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?!final$)[a-z][a-z0-9-]*)?$/.test(options.version)) {
        throw new Error(`Unsupported specification version ${options.version}; use X.Y.Z with an optional -status suffix`);
    }
    if (options.theme !== 'all' && !themes.includes(options.theme)) {
        throw new Error(`Unsupported theme ${options.theme}; choose all, light, dark, or print`);
    }
    return options;
}

function compareVersions(left, right) {
    const [leftMajor, leftMinor, leftPatch] = left.split('.').map(Number);
    const [rightMajor, rightMinor, rightPatch] = right.split('.').map(Number);
    return leftMajor - rightMajor || leftMinor - rightMinor || leftPatch - rightPatch;
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
        if (token.type === 'strong') runs.push(...inlineRuns(token.tokens, {...style, bold: true}));
        else if (token.type === 'em') runs.push(...inlineRuns(token.tokens, {...style, italic: true}));
        else if (token.type === 'del') runs.push(...inlineRuns(token.tokens, {...style, strike: true}));
        else if (token.type === 'link') runs.push(...inlineRuns(token.tokens, {...style, link: token.href}));
        else if (token.type === 'br') runs.push({...style, text: '\n'});
        else if (token.type === 'codespan') runs.push({...style, code: true, text: token.text});
        else if (token.type === 'text' && token.tokens) runs.push(...inlineRuns(token.tokens, style));
        else if (['text', 'escape', 'html'].includes(token.type)) runs.push({
            ...style,
            text: token.text ?? token.raw ?? ''
        });
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
    let spaces = [];
    for (const run of runs) {
        const font = fontFor(fonts, run);
        const normalized = normalizeText(run.text);
        const chunks = normalized.split(/(\s+)/).filter(Boolean);
        for (let chunk of chunks) {
            if (chunk.includes('\n')) {
                const pieces = chunk.split('\n');
                pieces.forEach((piece, index) => {
                    if (piece) addPiece(piece);
                    if (index < pieces.length - 1) {
                        lines.push([]);
                        lineWidth = 0;
                        spaces = [];
                    }
                });
                continue;
            }
            if (!/^\s+$/.test(chunk) && font.widthOfTextAtSize(chunk, size) > width) {
                for (const piece of splitLongWord(chunk, font, size, width)) addPiece(piece);
            } else addPiece(chunk);
        }

        function addPiece(piece) {
            if (/^\s+$/.test(piece)) {
                if (lineWidth) spaces.push({...run, text: piece});
                return;
            }
            const pieceWidth = font.widthOfTextAtSize(piece, size);
            const spaceWidth = spaces.reduce((sum, pending) => sum + fontFor(fonts, pending).widthOfTextAtSize(pending.text, size), 0);
            if (lineWidth && lineWidth + spaceWidth + pieceWidth > width) {
                lines.push([]);
                lineWidth = 0;
                spaces = [];
            }
            for (const pending of spaces) {
                lines.at(-1).push(pending);
                lineWidth += fontFor(fonts, pending).widthOfTextAtSize(pending.text, size);
            }
            spaces = [];
            lines.at(-1).push({...run, text: piece});
            lineWidth += pieceWidth;
        }
    }
    return lines;
}

function createFlow(document, metadata, theme, fonts, {initialPageNumber = 0, pages = [], compact = false} = {}) {
    let page;
    let y;
    let pageNumber = initialPageNumber;
    const records = [];
    const headings = new Map();
    const cache = new WeakMap();
    const bodyLeading = compact ? 13.5 : BODY_LEADING;
    const paragraphGap = compact ? 5 : 7;

    function newPage() {
        page = pages.shift() ?? document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        page.drawRectangle({x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: theme.paper});
        pageNumber += 1;
        drawPageChrome(page, metadata, theme, fonts, pageNumber);
        y = CONTENT_TOP;
    }

    function ensure(height) {
        if (!page || (y - Math.min(height, CONTENT_HEIGHT) < CONTENT_BOTTOM && !atStart())) {
            newPage();
            return true;
        }
        return false;
    }

    function atStart() {
        return page && y === CONTENT_TOP;
    }

    function remaining() {
        return page ? Math.max(0, y - CONTENT_BOTTOM) : 0;
    }

    function record(kind, top, bottom, details = {}) {
        if (bottom < CONTENT_BOTTOM - 0.1 || top > CONTENT_TOP + 0.1) throw new Error(`${kind} extends outside page ${pageNumber}'s content area`);
        records.push({kind, page: pageNumber, top, bottom, ...details});
    }

    function drawTextLine(line, x, baseline, size, options = {}) {
        let cursorX = x;
        for (const run of line) {
            const font = fontFor(fonts, run);
            const runColor = options.color ?? (run.link ? theme.accent : theme.ink);
            page.drawText(normalizeText(run.text), {x: cursorX, y: baseline, size, font, color: runColor});
            const width = font.widthOfTextAtSize(normalizeText(run.text), size);
            if (run.link) page.drawLine({
                start: {x: cursorX, y: baseline - 1.5},
                end: {x: cursorX + width, y: baseline - 1.5},
                thickness: 0.4,
                color: runColor
            });
            if (run.strike) page.drawLine({
                start: {x: cursorX, y: baseline + size * 0.32},
                end: {x: cursorX + width, y: baseline + size * 0.32},
                thickness: 0.45,
                color: runColor
            });
            cursorX += width;
        }
    }

    function drawRuns(runs, {
        x = LEFT,
        width = RIGHT - LEFT,
        size = BODY_SIZE,
        leading = bodyLeading,
        color: ink,
        minLines = 2,
        keepTogether = 4,
        onFirstLine,
        kind = 'paragraph'
    } = {}) {
        const lines = wrapRuns(runs, width, size, fonts);
        let offset = 0;
        while (offset < lines.length) {
            if (!page) newPage();
            const count = chooseLineCount(lines.length - offset, remaining() / leading, CONTENT_HEIGHT / leading, {
                minLines,
                keepTogether
            });
            if (!count) {
                newPage();
                continue;
            }
            const top = y;
            for (const line of lines.slice(offset, offset + count)) {
                if (offset === 0 && y === top) onFirstLine?.(page, y - size);
                drawTextLine(line, x, y - size, size, {color: ink});
                y -= leading;
            }
            record(kind, top, y, {
                lines: count,
                totalLines: lines.length,
                continuation: offset > 0,
                text: runs.map((run) => run.text).join('')
            });
            offset += count;
            if (offset < lines.length) newPage();
        }
    }

    function gap(value) {
        y -= value * (compact ? 0.85 : 1);
    }

    function getPage() {
        return page;
    }

    function getY() {
        return y;
    }

    function setY(value) {
        y = value;
    }

    return {
        newPage,
        ensure,
        atStart,
        remaining,
        record,
        records,
        headings,
        cache,
        document,
        bodyLeading,
        paragraphGap,
        getPageNumber: () => pageNumber,
        drawTextLine,
        drawRuns,
        gap,
        getPage,
        getY,
        setY,
        fonts,
        theme
    };
}

function tocTokens(tokens) {
    const result = [];
    for (const token of tokens) {
        if (token.type === 'heading' && token.depth > 1 && token.depth < 5) {
            result.push({token, depth: token.depth, text: textOf(token.tokens)});
        }
    }
    return result;
}

function measureToc(entries, fonts) {
    let pages = 1;
    let remaining = CONTENT_HEIGHT - 45;
    for (const entry of entries) {
        const indent = (entry.depth - 2) * 15;
        entry.height = wrapRuns([{
            text: entry.text,
            bold: entry.depth === 2
        }], RIGHT - LEFT - indent - 32, entry.depth === 2 ? 10 : 8.8, fonts).length * 16;
        if (entry.height > remaining) {
            pages += 1;
            remaining = CONTENT_HEIGHT - 45;
        }
        remaining -= entry.height;
    }
    return pages;
}

function drawToc(flow, entries, headings) {
    flow.newPage();
    const title = () => {
        flow.drawRuns([{text: 'Contents', bold: true}], {
            size: 24,
            leading: 31,
            color: flow.theme.accent,
            kind: 'toc-title'
        });
        flow.gap(14);
    };
    title();
    for (const entry of entries) {
        if (flow.remaining() < entry.height) {
            flow.newPage();
            title();
        }
        const indent = (entry.depth - 2) * 15;
        const top = flow.getY();
        const target = headings.get(entry.token);
        const size = entry.depth === 2 ? 10 : 8.8;
        flow.drawRuns([{text: entry.text, bold: entry.depth === 2}], {
            x: LEFT + indent,
            width: RIGHT - LEFT - indent - 32,
            size,
            leading: 16,
            kind: 'toc-entry',
            keepTogether: 100
        });
        const label = String(target.pageNumber).padStart(2, '0');
        flow.drawTextLine([{
            text: label,
            bold: true
        }], RIGHT - flow.fonts.bold.widthOfTextAtSize(label, 8), top - size, 8, {color: flow.theme.accent});
        const annotation = flow.document.context.obj({
            Type: 'Annot', Subtype: 'Link', Rect: [LEFT + indent, flow.getY(), RIGHT, top], Border: [0, 0, 0],
            Dest: [target.page.ref, PDFName.of('XYZ'), LEFT, target.y, null],
        });
        flow.getPage().node.addAnnot(flow.document.context.register(annotation));
    }
}

function drawParagraph(flow, token, options = {}) {
    const runs = inlineRuns(token.tokens);
    if (options.italic) runs.forEach((run) => {
        run.italic = true;
    });
    flow.drawRuns(runs, options);
    flow.gap(options.after ?? flow.paragraphGap);
}

function codeRows(flow, token) {
    if (!flow.cache.has(token)) flow.cache.set(token, wrapCode(normalizeText(token.text), (text) => flow.fonts.code.widthOfTextAtSize(text, CODE_SIZE), RIGHT - LEFT - 24));
    return flow.cache.get(token);
}

function drawCode(flow, token) {
    const innerX = LEFT + 12;
    const rows = codeRows(flow, token);
    const language = (token.lang ?? 'code').split(/[\s,]/)[0].toUpperCase();
    const overhead = CODE_LABEL_HEIGHT + CODE_PADDING;
    const fullCapacity = Math.floor((CONTENT_HEIGHT - overhead) / CODE_LEADING);
    let index = 0;
    while (index < rows.length) {
        flow.ensure(overhead + Math.min(3, rows.length - index) * CODE_LEADING);
        const capacity = Math.floor((flow.remaining() - overhead) / CODE_LEADING);
        const previous = flow.records.at(-1);
        const attached = index === 0 && previous?.page === flow.getPageNumber()
            && (previous.kind === 'heading' || (previous.kind === 'paragraph' && previous.lines <= 3 && /:\s*$/.test(previous.text)));
        const count = chooseCodeCount(rows, index, capacity, fullCapacity, {keepTogether: !attached || rows.length <= capacity});
        if (!count) {
            flow.newPage();
            continue;
        }
        const chunk = rows.slice(index, index + count);
        const height = overhead + chunk.length * CODE_LEADING;
        const top = flow.getY();
        const page = flow.getPage();
        page.drawRectangle({x: LEFT, y: top - height, width: RIGHT - LEFT, height, color: flow.theme.surface});
        page.drawRectangle({x: LEFT, y: top - height, width: 3, height, color: flow.theme.accent});
        page.drawText(index ? `${language} / CONTINUED` : language, {
            x: innerX,
            y: top - 12,
            size: 6.2,
            font: flow.fonts.bold,
            color: flow.theme.accent
        });
        chunk.forEach((line, row) => {
            let x = innerX;
            for (const run of codeRuns(line, token.highlightedLines?.[line.source])) {
                if (!run.text) continue;
                page.drawText(run.text, {
                    x, y: top - CODE_LABEL_HEIGHT - CODE_SIZE - row * CODE_LEADING,
                    size: CODE_SIZE, font: flow.fonts.code,
                    color: run.color ? color(run.color) : flow.theme.codeInk,
                });
                x += flow.fonts.code.widthOfTextAtSize(run.text, CODE_SIZE);
            }
        });
        flow.record('code', top, top - height, {
            rows: count,
            continuation: index > 0,
            firstSource: chunk[0].source,
            lastSource: chunk.at(-1).source
        });
        flow.setY(top - height - 8);
        index += chunk.length;
        if (index < rows.length) flow.newPage();
    }
}

function listItemHeights(flow, token, level = 0) {
    const width = RIGHT - LEFT - level * 12 - 18;
    return token.items.map((item) => {
        let height = 2;
        for (const part of item.tokens ?? []) {
            if (['text', 'paragraph'].includes(part.type)) {
                height += wrapRuns(inlineRuns(part.tokens ?? [{
                    type: 'text',
                    text: part.text
                }]), width, BODY_SIZE, flow.fonts).length * flow.bodyLeading + (part.type === 'paragraph' ? 2 : 0);
            } else if (part.type === 'list') {
                const nested = listItemHeights(flow, part, level + 1);
                if (nested.some((value) => value === undefined)) return undefined;
                height += nested.reduce((sum, value) => sum + value, 3);
            } else if (part.type !== 'space') return undefined;
        }
        return height;
    });
}

function drawList(flow, token, level = 0) {
    const base = Number(token.start) || 1;
    const itemX = LEFT + level * 12;
    const bodyX = itemX + 18;
    const bodyWidth = RIGHT - bodyX;
    const heights = listItemHeights(flow, token, level);
    const wholeHeight = heights.every((height) => height !== undefined) ? heights.reduce((sum, height) => sum + height, 3) : Infinity;
    if (wholeHeight <= 240) flow.ensure(wholeHeight);
    token.items.forEach((item, index) => {
        if (index === token.items.length - 2 && heights[index] + heights[index + 1] <= 140) flow.ensure(heights[index] + heights[index + 1]);
        const marker = item.task ? (item.checked ? '[x]' : '[ ]') : token.ordered ? `${base + index}.` : '-';
        const itemTokens = item.tokens ?? [];
        let markerPending = true;
        const firstText = itemTokens.find((part) => ['text', 'paragraph'].includes(part.type));
        if (firstText) {
            const lines = wrapRuns(inlineRuns(firstText.tokens ?? [{
                type: 'text',
                text: firstText.text
            }]), bodyWidth, BODY_SIZE, flow.fonts).length;
            flow.ensure(Math.min(lines, lines <= 6 ? 6 : 3) * flow.bodyLeading);
        }
        const drawItemText = (runs) => {
            flow.drawRuns(runs, {
                x: bodyX,
                width: bodyWidth,
                size: BODY_SIZE,
                leading: flow.bodyLeading,
                kind: 'list-item',
                keepTogether: 6,
                onFirstLine: () => {
                    if (!markerPending) return;
                    flow.drawTextLine([{text: marker}], itemX, flow.getY() - BODY_SIZE, BODY_SIZE);
                    markerPending = false;
                },
            });
        };

        for (const part of itemTokens) {
            if (part.type === 'text' || part.type === 'paragraph') {
                drawItemText(inlineRuns(part.tokens ?? [{type: 'text', text: part.text ?? ''}]));
                if (part.type === 'paragraph') flow.gap(2);
            } else if (part.type === 'list') {
                if (markerPending) {
                    flow.ensure(flow.bodyLeading);
                    flow.drawTextLine([{text: marker}], itemX, flow.getY() - BODY_SIZE, BODY_SIZE);
                    flow.gap(flow.bodyLeading);
                    markerPending = false;
                }
                drawList(flow, part, level + 1);
            } else {
                if (markerPending) {
                    flow.ensure(flow.bodyLeading);
                    flow.drawTextLine([{text: marker}], itemX, flow.getY() - BODY_SIZE, BODY_SIZE);
                    flow.gap(flow.bodyLeading);
                    markerPending = false;
                }
                renderTokens(flow, [part]);
            }
        }
        if (markerPending) {
            flow.ensure(flow.bodyLeading);
            flow.drawTextLine([{text: marker}], itemX, flow.getY() - BODY_SIZE, BODY_SIZE);
            flow.gap(flow.bodyLeading);
        }
        flow.gap(2);
    });
    flow.gap(3);
}

function measureTable(flow, token) {
    if (flow.cache.has(token)) return flow.cache.get(token);
    const rows = [token.header, ...token.rows];
    const columnCount = Math.max(1, token.header.length);
    const fontSize = 7.8;
    const lineHeight = 10;
    const allRuns = rows.map((row, index) => Array.from({length: columnCount}, (_, col) => {
        const cell = row[col] ?? {};
        return inlineRuns(cell.tokens ?? [{type: 'text', text: cell.text ?? ''}]).map((run) => ({
            ...run,
            bold: index === 0 || run.bold
        }));
    }));
    const preferred = Array.from({length: columnCount}, (_, col) => Math.max(...allRuns.map((row) => row[col].reduce((sum, run) => sum + fontFor(flow.fonts, run).widthOfTextAtSize(normalizeText(run.text), fontSize), 0) + 12)));
    const widths = tableColumnWidths(preferred, RIGHT - LEFT);
    const measured = allRuns.map((row) => {
        const lines = row.map((runs, col) => wrapRuns(runs, widths[col] - 12, fontSize, flow.fonts));
        const count = Math.max(...lines.map((cell) => cell.length));
        return {lines, count, height: Math.max(25, count * lineHeight + 12)};
    });
    const table = {widths, rows: measured, fontSize, lineHeight};
    flow.cache.set(token, table);
    return table;
}

function tableStartHeight(table) {
    const {rows} = table;
    const total = rows.reduce((sum, row) => sum + row.height, 0);
    if (total <= CONTENT_HEIGHT * 0.45 || (rows.length <= 3 && total <= CONTENT_HEIGHT)) return total;
    const available = CONTENT_HEIGHT - rows[0].height;
    const first = rows[1]?.height ?? 0;
    if (first > available) return rows[0].height + 100;
    const second = rows[2]?.height ?? 0;
    return rows[0].height + first + (first + second <= 140 ? second : 0);
}

function drawTable(flow, token) {
    const table = measureTable(flow, token);
    const {widths, rows, fontSize, lineHeight} = table;
    const header = rows[0];
    if (header.height + 25 > CONTENT_HEIGHT) throw new Error('Table header is taller than the available page area');
    flow.ensure(tableStartHeight(table));

    function drawRow(row, index, offset = 0, count = row.count) {
        const rowHeight = Math.max(25, count * lineHeight + 12);
        const yTop = flow.getY();
        let x = LEFT;
        for (let column = 0; column < widths.length; column += 1) {
            const isHead = index === 0;
            const fill = isHead ? flow.theme.tableHead : (index % 2 === 0 ? flow.theme.soft : flow.theme.paper);
            flow.getPage().drawRectangle({
                x,
                y: yTop - rowHeight,
                width: widths[column],
                height: rowHeight,
                color: fill,
                borderColor: flow.theme.line,
                borderWidth: 0.6
            });
            let lineY = yTop - 6;
            for (const line of row.lines[column].slice(offset, offset + count)) {
                const lineWidth = line.reduce((sum, run) => sum + fontFor(flow.fonts, run).widthOfTextAtSize(normalizeText(run.text), fontSize), 0);
                const alignment = token.align?.[column];
                const inset = alignment === 'right' ? widths[column] - lineWidth - 6 : alignment === 'center' ? (widths[column] - lineWidth) / 2 : 6;
                flow.drawTextLine(line, x + inset, lineY - fontSize, fontSize, {color: isHead ? flow.theme.tableHeadInk : undefined});
                lineY -= lineHeight;
            }
            x += widths[column];
        }
        flow.record(index === 0 ? 'table-header' : 'table-row', yTop, yTop - rowHeight, {
            row: index,
            continuation: offset > 0
        });
        flow.setY(yTop - rowHeight);
    }

    drawRow(header, 0);
    for (let index = 1; index < rows.length; index += 1) {
        const row = rows[index];
        // Keep the last two rows together when they fit on a fresh table page.
        const reserve = index === rows.length - 2 && row.height + rows[index + 1].height <= CONTENT_HEIGHT - header.height
            ? row.height + rows[index + 1].height : row.height > CONTENT_HEIGHT - header.height ? 100 : row.height;
        if (flow.remaining() < reserve) {
            flow.newPage();
            drawRow(header, 0);
        }
        let offset = 0;
        while (offset < row.count) {
            const capacity = Math.floor((flow.remaining() - 12) / lineHeight);
            const count = chooseLineCount(row.count - offset, capacity, (CONTENT_HEIGHT - header.height - 12) / lineHeight, {keepTogether: 4});
            if (!count || flow.remaining() < Math.max(25, count * lineHeight + 12)) {
                flow.newPage();
                drawRow(header, 0);
                continue;
            }
            drawRow(row, index, offset, count);
            offset += count;
            if (offset < row.count) {
                flow.newPage();
                drawRow(header, 0);
            }
        }
    }
    flow.gap(9);
}

function quoteLines(flow, token) {
    if (flow.cache.has(token)) return flow.cache.get(token);

    function quoteRuns(tokens) {
        return tokens.flatMap((child) => {
            if (['paragraph', 'text'].includes(child.type)) return [...inlineRuns(child.tokens ?? [{
                type: 'text',
                text: child.text
            }]), {text: '\n'}];
            if (child.type === 'list') return child.items.flatMap((item, index) => [{text: child.ordered ? `${Number(child.start) + index}. ` : '- '}, ...quoteRuns(item.tokens)]);
            if (child.type === 'code') return [{text: child.text + '\n', code: true}];
            return child.tokens ? quoteRuns(child.tokens) : [];
        });
    }

    const runs = quoteRuns(token.tokens ?? []).map((run) => ({...run, italic: !run.code}));
    if (runs.at(-1)?.text === '\n') runs.pop();
    const lines = wrapRuns(runs, RIGHT - LEFT - 26, 9.2, flow.fonts);
    flow.cache.set(token, lines);
    return lines;
}

function drawBlockquote(flow, token) {
    const lines = quoteLines(flow, token);
    let offset = 0;
    while (offset < lines.length) {
        flow.ensure(14 + Math.min(2, lines.length - offset) * 14);
        const count = chooseLineCount(lines.length - offset, (flow.remaining() - 14) / 14, (CONTENT_HEIGHT - 14) / 14, {keepTogether: 6});
        if (!count) {
            flow.newPage();
            continue;
        }
        const height = count * 14 + 14;
        const top = flow.getY();
        flow.getPage().drawRectangle({
            x: LEFT,
            y: top - height,
            width: RIGHT - LEFT,
            height,
            color: flow.theme.surface,
            borderColor: flow.theme.line,
            borderWidth: 0.6
        });
        flow.getPage().drawRectangle({x: LEFT, y: top - height, width: 3, height, color: flow.theme.accent});
        lines.slice(offset, offset + count).forEach((line, index) => flow.drawTextLine(line, LEFT + 13, top - 7 - 9.2 - index * 14, 9.2));
        flow.record('quote', top, top - height, {lines: count, continuation: offset > 0});
        flow.setY(top - height - 8);
        offset += count;
        if (offset < lines.length) flow.newPage();
    }
}

function headingStyle(token) {
    const size = token.depth === 2 ? 17 : token.depth === 3 ? 12.5 : 10.5;
    return {size, leading: size + 5, before: token.depth === 2 ? 10 : 6, after: token.depth === 2 ? 4 : 3};
}

function measureStart(flow, token) {
    if (!token) return 0;
    switch (token.type) {
        case 'paragraph':
        case 'text': {
            const lines = wrapRuns(inlineRuns(token.tokens ?? [{
                type: 'text',
                text: token.text
            }]), RIGHT - LEFT, BODY_SIZE, flow.fonts).length;
            return Math.min(lines, lines <= 6 ? 6 : 3) * flow.bodyLeading;
        }
        case 'code': {
            const rows = codeRows(flow, token).length;
            const fullCapacity = Math.floor((CONTENT_HEIGHT - CODE_LABEL_HEIGHT - CODE_PADDING) / CODE_LEADING);
            return CODE_LABEL_HEIGHT + CODE_PADDING + Math.min(rows, rows <= fullCapacity ? fullCapacity : 6) * CODE_LEADING;
        }
        case 'table': {
            return tableStartHeight(measureTable(flow, token));
        }
        case 'list': {
            const heights = listItemHeights(flow, token);
            const wholeHeight = heights.every((height) => height !== undefined) ? heights.reduce((sum, height) => sum + height, 3) : Infinity;
            if (wholeHeight <= 240) return wholeHeight;
            const first = token.items[0]?.tokens?.find((part) => ['text', 'paragraph'].includes(part.type));
            if (!first) return 3 * flow.bodyLeading;
            const lines = wrapRuns(inlineRuns(first.tokens ?? [{
                type: 'text',
                text: first.text
            }]), RIGHT - LEFT - 18, BODY_SIZE, flow.fonts).length;
            return Math.min(lines, lines <= 6 ? 6 : 3) * flow.bodyLeading;
        }
        case 'blockquote': {
            const lines = quoteLines(flow, token).length;
            return Math.min(lines, lines <= 6 ? 6 : 3) * 14 + 14;
        }
        default:
            return 0;
    }
}

function followingStart(flow, tokens, start) {
    let height = 0;
    for (const [offset, token] of tokens.slice(start).entries()) {
        if (['space', 'def'].includes(token.type)) continue;
        if (token.type === 'heading') {
            const style = headingStyle(token);
            height += style.before + wrapRuns([{
                text: textOf(token.tokens),
                bold: true
            }], RIGHT - LEFT, style.size, flow.fonts).length * style.leading + style.after;
        } else {
            height += measureStart(flow, token);
            if (token.type === 'paragraph') {
                const lines = wrapRuns(inlineRuns(token.tokens), RIGHT - LEFT, BODY_SIZE, flow.fonts).length;
                const next = tokens.slice(start + offset + 1).find((part) => !['space', 'def'].includes(part.type));
                if (lines <= 3 && ['code', 'table', 'list', 'blockquote'].includes(next?.type)) height += flow.paragraphGap + measureStart(flow, next);
            }
            break;
        }
    }
    return height;
}

function renderTokens(flow, tokens) {
    for (const [index, token] of tokens.entries()) {
        switch (token.type) {
            case 'heading': {
                if (token.depth === 1) break;
                const style = headingStyle(token);
                const runs = [{text: textOf(token.tokens), bold: true}];
                const height = wrapRuns(runs, RIGHT - LEFT, style.size, flow.fonts).length * style.leading;
                flow.ensure(style.before + height + style.after + followingStart(flow, tokens, index + 1));
                if (!flow.atStart()) flow.gap(style.before);
                flow.headings.set(token, {page: flow.getPage(), pageNumber: flow.getPageNumber(), y: flow.getY()});
                flow.drawRuns(runs, {
                    size: style.size,
                    leading: style.leading,
                    color: token.depth === 2 ? flow.theme.accent : flow.theme.ink,
                    keepTogether: 100,
                    kind: 'heading'
                });
                flow.gap(style.after);
                break;
            }
            case 'paragraph': {
                const following = tokens.slice(index + 1).find((part) => !['space', 'def'].includes(part.type));
                const height = wrapRuns(inlineRuns(token.tokens), RIGHT - LEFT, BODY_SIZE, flow.fonts).length * flow.bodyLeading;
                if (height <= 3 * flow.bodyLeading && ['code', 'list', 'table', 'blockquote'].includes(following?.type)) flow.ensure(height + flow.paragraphGap + measureStart(flow, following));
                drawParagraph(flow, token);
                break;
            }
            case 'code':
                drawCode(flow, token);
                break;
            case 'list':
                drawList(flow, token);
                break;
            case 'table':
                drawTable(flow, token);
                break;
            case 'blockquote':
                drawBlockquote(flow, token);
                break;
            case 'hr': {
                flow.gap(4);
                flow.ensure(12);
                flow.getPage().drawLine({
                    start: {x: LEFT, y: flow.getY()},
                    end: {x: RIGHT, y: flow.getY()},
                    thickness: 0.5,
                    color: flow.theme.line
                });
                flow.gap(12);
                break;
            }
            default:
                break;
        }
    }
}

async function renderDocument(tokens, metadata, themeName, compact = false) {
    const document = await PDFDocument.create();
    document.setTitle(`${metadata.title} ${metadata.version} ${metadata.status}`);
    document.setAuthor('Kalm language project');
    document.setSubject(`Kalm ${metadata.version} language specification (${metadata.status})`);
    const fonts = await embeddedFonts(document);
    const theme = colors(themeName);
    drawCover(document, metadata, theme, fonts);
    const entries = tocTokens(tokens);
    const tocPages = Array.from({length: measureToc(entries, fonts)}, () => document.addPage([PAGE_WIDTH, PAGE_HEIGHT]));
    const flow = createFlow(document, metadata, theme, fonts, {initialPageNumber: tocPages.length, compact});
    renderTokens(flow, tokens);
    const tocFlow = createFlow(document, metadata, theme, fonts, {pages: [...tocPages]});
    drawToc(tocFlow, entries, flow.headings);
    return {
        document,
        pageCount: document.getPageCount(),
        compact,
        records: flow.records,
        contents: entries.map((entry) => ({text: entry.text, page: flow.headings.get(entry.token).pageNumber}))
    };
}

export async function buildPdf(source, outputPath, themeName) {
    const markdown = await readFile(source, 'utf8');
    const metadata = parseFrontMatter(markdown, path.relative(root, source));
    const tokens = marked.lexer(splitAtMain(markdown, source), {gfm: true});
    await highlightCodeBlocks(tokens, normalizeText, themeName);
    let result = await renderDocument(tokens, metadata, themeName);
    const last = result.records.at(-1);
    // A bounded retry can remove a nearly empty final page without shrinking type.
    if (last && result.pageCount > 3 && CONTENT_TOP - last.bottom < CONTENT_HEIGHT * 0.2) {
        const candidate = await renderDocument(tokens, metadata, themeName, true);
        if (candidate.pageCount < result.pageCount) result = candidate;
    }
    await writeFile(outputPath, await result.document.save());
    const {document, ...report} = result;
    return report;
}

async function main() {
    const options = parseArguments(process.argv.slice(2));
    const documentsDir = path.join(root, 'documents');
    const sources = (await readdir(documentsDir)).filter((name) => name.endsWith('.md')).sort()
        .map((name) => path.join(documentsDir, name));
    if (!sources.length) throw new Error(`No Markdown documents found in ${documentsDir}`);
    const documents = await Promise.all(sources.map(async (source) => {
        const markdown = await readFile(source, 'utf8');
        return {source, metadata: parseFrontMatter(markdown, path.relative(root, source))};
    }));
    const latestFinalVersion = documents.filter(({metadata}) => metadata.status === 'final')
        .map(({metadata}) => metadata.version).sort(compareVersions).at(-1);
    if (!options.all && !latestFinalVersion) throw new Error('No final specification version found');
    const [targetVersion, targetStatus] = options.version?.split(/-(.*)/s) ?? [];
    const selectedVersion = targetVersion ?? latestFinalVersion;
    const selected = options.all ? documents : documents.filter(({metadata}) => (
        metadata.version === selectedVersion && (!options.version || metadata.status === (targetStatus ?? 'final'))
    ));
    if (!selected.length) throw new Error(`No specification documents found for version ${selectedVersion}${targetStatus ? `-${targetStatus}` : ''}`);
    await mkdir(options.outputDir, {recursive: true});
    const selectedThemes = options.theme === 'all' ? themes : [options.theme];
    for (const {source} of selected) {
        for (const themeName of selectedThemes) {
            const outputPath = path.join(options.outputDir, `${path.parse(source).name}-${themeName}.pdf`);
            await buildPdf(source, outputPath, themeName);
            console.log(`Generated ${path.relative(root, outputPath)}`);
        }
    }
    console.log(`Generated ${selected.length * selectedThemes.length} PDFs for ${options.all ? 'all specification versions' : `version ${selectedVersion}`} in ${options.outputDir}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}
