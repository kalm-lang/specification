import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEditions, selectEditions } from '../scripts/editions.mjs';

test('1.2.0 final is selected while historical drafts and the final changes companion remain available', async () => {
  const entries = await loadEditions();
  const [current] = selectEditions(entries);
  assert.equal(current.metadata.version, '1.2.0');
  assert.equal(current.metadata.status, 'final');
  assert.equal(current.file, 'documents/v1.2.0.md');
  assert.equal(current.changes.file, 'changes/v1.2.0.md');
  assert.ok(entries.some(entry => entry.metadata.version === '1.2.0' && entry.metadata.status === 'draft'));
  assert.ok(entries.some(entry => entry.metadata.version === '1.1.0' && entry.metadata.status === 'final'));
  assert.doesNotMatch(current.markdown, /acceptance requirements for future|current releases implement every requirement/);
});
