import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import frontMatter from '../frontmatter.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { parseFrontMatter } = frontMatter;
const documentNames = (await readdir(path.join(root, 'documents')))
  .filter((file) => file.endsWith('.md'))
  .sort();
const documents = await Promise.all(documentNames.map(async (name) => {
  const file = path.join('documents', name);
  const contents = await readFile(path.join(root, file), 'utf8');
  return { file, metadata: parseFrontMatter(contents, file) };
}));
const compareVersions = (left, right) => {
  const [leftMajor, leftMinor] = left.split('.').map(Number);
  const [rightMajor, rightMinor] = right.split('.').map(Number);
  return leftMajor - rightMajor || leftMinor - rightMinor;
};
const finalVersions = documents
  .filter(({ metadata }) => metadata.status === 'final')
  .map(({ metadata }) => metadata.version)
  .sort(compareVersions);
if (!finalVersions.length) throw new Error('The documents folder must contain at least one final specification');

const explicit = process.env.INPUT_VERSION?.trim();
const eventName = process.env.EVENT_NAME;
const tagName = process.env.TAG_NAME ?? '';
let specificationIdentity;
if (explicit) {
  specificationIdentity = explicit;
} else if (eventName === 'push') {
  const tag = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-draft)?)$/.exec(tagName);
  if (!tag) throw new Error(`Tag ${tagName || '(empty)'} must use vX.Y or vX.Y-draft`);
  specificationIdentity = tag[1];
} else {
  specificationIdentity = finalVersions.at(-1);
}

const identity = /^(0|[1-9]\d*)\.(0|[1-9]\d*)(-draft)?$/.exec(specificationIdentity);
if (!identity) throw new Error(`Specification release must use X.Y or X.Y-draft; received: ${specificationIdentity || '(empty)'}`);
const majorMinor = `${identity[1]}.${identity[2]}`;
const status = identity[3] ? 'draft' : 'final';
const selected = documents.find(({ metadata }) => metadata.version === majorMinor && metadata.status === status);
if (!selected) throw new Error(`No ${status} specification document exists for version ${majorMinor}`);

const tag = `v${majorMinor}${status === 'draft' ? '-draft' : ''}`;
if (eventName === 'push' && tagName !== tag) {
  throw new Error(`Tag ${tagName} does not match resolved specification version ${majorMinor}${status === 'draft' ? '-draft' : ''}`);
}

// npm requires three numeric components; the Git tag and specification stay X.Y.
const packageVersion = `${majorMinor}.0${status === 'draft' ? '-draft' : ''}`;
const pdfVersion = `${majorMinor}${status === 'draft' ? '-draft' : ''}`;
console.log(`version=${packageVersion}`);
console.log(`specification_version=${majorMinor}`);
console.log(`status=${status}`);
console.log(`pdf_version=${pdfVersion}`);
console.log(`tag=${tag}`);
