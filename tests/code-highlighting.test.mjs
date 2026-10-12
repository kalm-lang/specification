import test from 'node:test';
import assert from 'node:assert/strict';
import { highlightCodeBlocks, codeRuns } from '../scripts/code-highlighting.mjs';
import { wrapCode } from '../scripts/pdf-layout.mjs';
import { normalizeText } from '../templates/specification-pdf-template.mjs';

test('wrapped PDF code preserves source and colors across tokens and multiline comments', async () => {
  const source = '\t## a long comment with 😀 and multiple visual rows\ncontinued ##\n\tfix value = "long string content"\n';
  for (const theme of ['light', 'dark', 'print']) {
    const block = { type: 'code', lang: 'kalm', text: source };
    await highlightCodeBlocks([block], normalizeText, theme);
    const rows = wrapCode(normalizeText(source), value => [...value].length, 18);
    for (const row of rows) {
      const runs = codeRuns(row, block.highlightedLines[row.source]);
      assert.equal(runs.map(run => run.text).join(''), row.text);
      assert.equal(runs.filter(run => run.color).map(run => run.text).join(''), row.sourceText);
    }
    assert.equal(block.highlightedLines[0].find(token => token.content.includes('##')).color,
      block.highlightedLines[1][0].color);
    assert.ok(rows.some(row => row.continuation && row.prefix));
  }
});

test('unknown PDF fence languages keep literal text and nested blocks are prepared', async () => {
  const block = { type: 'code', lang: 'unknown', text: '<script>&\n\nlast' };
  await highlightCodeBlocks([{ type: 'blockquote', tokens: [block] }], value => value, 'light');
  assert.equal(block.highlightedLines.map(line => line.map(token => token.content).join('')).join('\n'), block.text);
  assert.equal(new Set(block.highlightedLines.flat().map(token => token.color)).size, 1);
});
