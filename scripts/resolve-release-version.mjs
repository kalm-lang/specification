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
const finalVersions = documents
  .filter(({ metadata }) => metadata.status === 'final')
  .map(({ metadata }) => metadata.version)
  .sort((left, right) => {
    const [leftMajor, leftMinor] = left.split('.').map(Number);
    const [rightMajor, rightMinor] = right.split('.').map(Number);
    return leftMajor - rightMajor || leftMinor - rightMinor;
  });
if (finalVersions.length === 0) {
  throw new Error('The documents folder must contain at least one final specification');
}
const latestSeries = finalVersions.at(-1);
const explicit = process.env.INPUT_VERSION?.trim();
const eventName = process.env.EVENT_NAME;
const tagName = process.env.TAG_NAME ?? '';
let version;

if (explicit) {
  version = explicit.replace(/^v/, '');
} else if (eventName === 'push') {
  version = tagName.replace(/^v/, '');
} else {
  version = process.env.GITVERSION_VERSION ?? '';
  const calculatedVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.exec(version);
  if (calculatedVersion) {
    const calculatedSeries = `${calculatedVersion[1]}.${calculatedVersion[2]}`;
    version = calculatedSeries === latestSeries
      ? `${calculatedSeries}.${calculatedVersion[3]}`
      : `${latestSeries}.0`;
  }
}

if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  throw new Error(`Release version must be plain SemVer (x.y.z); received: ${version || '(empty)'}`);
}

const versionMatch = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
const majorMinor = versionMatch ? `${versionMatch[1]}.${versionMatch[2]}` : '';

if (!documents.some(({ metadata }) => metadata.version === majorMinor && metadata.status === 'final')) {
  throw new Error(`No final specification document exists for release series ${majorMinor || version}`);
}

if (eventName === 'push' && tagName !== `v${version}`) {
  throw new Error(`Tag ${tagName} does not match resolved version ${version}`);
}

console.log(`version=${version}`);
console.log(`tag=v${version}`);
