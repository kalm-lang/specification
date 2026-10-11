import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { buildPdf } from '../scripts/build-pdfs.mjs';

const require = createRequire(import.meta.url);
const { PDFDocument, PDFName } = require('pdf-lib');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function validateLayout(result) {
  const { records } = result;
  for (const [index, block] of records.entries()) {
    if (block.kind === 'heading' && records[index + 1]) {
      assert.equal(block.page, records[index + 1].page, `Detached heading: ${block.text}`);
    }
    if (['paragraph', 'list-item'].includes(block.kind) && block.totalLines > block.lines) {
      assert.ok(block.lines >= 2, `Single paragraph line on page ${block.page}: ${block.text}`);
    }
    if (block.kind === 'table-row') {
      assert.ok(records.slice(0, index).some((entry) => entry.page === block.page && entry.kind === 'table-header'), `Missing table header on page ${block.page}`);
    }
    assert.ok(block.top >= block.bottom, `Invalid geometry on page ${block.page}`);
  }
  const references = records.findIndex((block) => block.kind === 'heading' && block.text === 'References');
  if (references >= 0) {
    assert.ok(records.slice(references + 1).every((block) => block.page === records[references].page), 'Short reference lists should stay with their heading');
  }
  assert.ok(result.contents.every((entry) => entry.page > 1 && entry.page < result.pageCount));
}

test('pagination protects section starts and safely splits long blocks', async () => {
  await mkdir(path.join(root, 'tmp'), { recursive: true });
  const temp = await mkdtemp(path.join(root, 'tmp', 'pdf-pagination-'));
  try {
    const fixture = [
      ['---', "$schema: '../schemas/frontmatter.schema.json'", "title: 'Kalm Language Specification'",
        "version: '1.1.0'", "status: 'draft'", "date: '2026-10-11'", "lastmod: '2026-10-11'", "javaversion: '25'", "revision: '1'", '---'].join('\n'),
      '[main]: #intro', '## Intro',
      Array.from({ length: 43 }, (_, i) => `Explicit paragraph line ${i + 1}.  `).join('\n'),
      '## Boundary heading', '### Adjacent subheading', 'A short introduction to this example:',
      ['```kalm', ...Array.from({ length: 14 }, (_, i) => `    call${i}("${'veryLongIdentifier'.repeat(9)}");`), '```'].join('\n'),
      '## Almost full-page example', ['```kalm', ...Array.from({ length: 56 }, (_, i) => `    val${i} = compute(${i});`), '```'].join('\n'),
      '## Long code', ['```kalm', ...Array.from({ length: 110 }, (_, i) => i % 9 === 8 ? '' : `    val${i} = compute(${i});`), '```'].join('\n'),
      '## Long table', ['| Key | Explanation |', '|---|---|',
        ...Array.from({ length: 70 }, (_, i) => `| ROW_${i} | ${'Useful table explanation. '.repeat(4)} |`),
        `| OVERSIZED_ROW | ${'Very long cell content that must cross pages. '.repeat(180)} |`].join('\n'),
      '## Long quote', Array.from({ length: 90 }, (_, i) => `> Quote line ${i + 1}.  `).join('\n'),
      '## Nested lists', ['1. The first ordered item.', '   - A nested item.', '   - A second nested item.', '2. The next ordered item.'].join('\n'),
      '## Ending', 'All layout content reached the final page.',
    ].join('\n\n');
    const source = path.join(temp, 'fixture.md');
    const output = path.join(temp, 'fixture.pdf');
    await writeFile(source, fixture);
    const result = await buildPdf(source, output, 'light');
    validateLayout(result);
    assert.ok(result.records.filter((record) => record.kind === 'table-header').length > 3);
    assert.ok(result.records.some((record) => record.kind === 'table-row' && record.continuation));
    assert.ok(result.records.some((record) => record.kind === 'code' && record.continuation));
    assert.ok(result.records.some((record) => record.kind === 'quote' && record.continuation));
    const pdf = await PDFDocument.load(await readFile(output));
    assert.ok(pdf.getPage(1).node.Annots().size() > 0, 'Contents must have navigable links');
    const annotation = pdf.context.lookup(pdf.getPage(1).node.Annots().get(0));
    assert.equal(annotation.get(PDFName.of('Subtype')).toString(), '/Link');
    const destination = annotation.get(PDFName.of('Dest')).get(0).toString();
    assert.ok(pdf.getPages().some((page) => page.ref.toString() === destination), 'Contents destination must reference a real page');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('bounded reflow removes a sparse final page without discarding text', async () => {
  await mkdir(path.join(root, 'tmp'), { recursive: true });
  const temp = await mkdtemp(path.join(root, 'tmp', 'pdf-reflow-'));
  try {
    const frontMatter = (await readFile(path.join(root, 'documents', 'v1.1.0.md'), 'utf8')).match(/^---[\s\S]*?\n---/)[0];
    const source = path.join(temp, 'reflow.md');
    await writeFile(source, [frontMatter, '[main]: #intro', '## Intro',
      Array.from({ length: 42 }, (_, i) => `Explicit paragraph line ${i + 1}.  `).join('\n'),
      '## References', '- Reference one\n- Reference two\n- Reference three'].join('\n\n'));
    const result = await buildPdf(source, path.join(temp, 'reflow.pdf'), 'light');
    assert.equal(result.compact, true);
    assert.equal(result.pageCount, 3);
    assert.equal(result.records.filter((block) => block.kind === 'paragraph').reduce((sum, block) => sum + block.lines, 0), 42);
    validateLayout(result);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('every specification keeps headings with content and avoids paragraph widows', async () => {
  await mkdir(path.join(root, 'tmp'), { recursive: true });
  const temp = await mkdtemp(path.join(root, 'tmp', 'pdf-corpus-'));
  try {
    const sources = (await readdir(path.join(root, 'documents'))).filter((name) => name.endsWith('.md'));
    for (const name of sources) {
      const result = await buildPdf(path.join(root, 'documents', name), path.join(temp, `${name}.pdf`), 'light');
      validateLayout(result);
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
