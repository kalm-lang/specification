import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseLineCount, chooseCodeCount, wrapCode, tableColumnWidths } from '../scripts/pdf-layout.mjs';

test('paragraph splitting avoids stranded first and last lines', () => {
  assert.equal(chooseLineCount(3, 2, 40), 0);
  assert.equal(chooseLineCount(8, 1, 40), 0);
  assert.equal(chooseLineCount(8, 7, 40), 6);
  assert.equal(chooseLineCount(50, 40, 40), 40);
  assert.equal(chooseLineCount(1, 1, 40), 1);
});

test('code wraps long tokens, preserves indentation and fits the measured width', () => {
  const line = '    call("a very long string that exceeds the width", extremelyLongIdentifier);';
  const rows = wrapCode(`${line}\n}`, (text) => text.length, 26);
  assert.ok(rows.length > 3);
  assert.ok(rows.every((row) => row.text.length <= 26));
  assert.ok(rows.filter((row) => row.continuation).every((row) => row.text.startsWith('       ')));
  assert.equal(rows.at(-1).breakAfter, true);
  assert.ok(rows.map((row) => row.text.trim()).join('').includes('extremelyLongIdentifier'));
  assert.equal(rows.filter((row) => row.source === 0).map((row) => row.sourceText).join(''), line);
});

test('code pagination prefers complete examples and source-line boundaries', () => {
  const rows = Array.from({ length: 80 }, (_, source) => ({ source, breakAfter: source === 23 }));
  assert.equal(chooseCodeCount(rows, 0, 27, 50), 24);
  assert.equal(chooseCodeCount(rows.slice(0, 12), 0, 10, 50), 0);
  assert.equal(chooseCodeCount(rows.slice(0, 40), 0, 35, 50), 0);
  const wrapped = [{ source: 0 }, ...Array.from({ length: 5 }, () => ({ source: 1 })), { source: 2 }];
  assert.equal(chooseCodeCount(wrapped, 0, 4, 6), 1);
});

test('table columns share the available width according to content', () => {
  const widths = tableColumnWidths([90, 250, 120], 476);
  assert.ok(widths[1] > widths[2] && widths[2] > widths[0]);
  assert.ok(widths.every((width) => width >= 64));
  assert.ok(Math.abs(widths.reduce((sum, width) => sum + width, 0) - 476) < 0.0001);
});
