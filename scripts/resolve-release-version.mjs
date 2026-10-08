import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const map = JSON.parse(await readFile(path.join(root, 'specification-map.json'), 'utf8'));
const explicit = process.env.INPUT_VERSION?.trim();
const eventName = process.env.EVENT_NAME;
const tagName = process.env.TAG_NAME ?? '';
let version;

if (explicit) {
  version = explicit.replace(/^v/, '');
} else if (eventName === 'push') {
  version = tagName.replace(/^v/, '');
} else {
  version = process.env.GITVERSION_SEMVER ?? '';
}

if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  throw new Error(`Release version must be plain SemVer (x.y.z); received: ${version || '(empty)'}`);
}

const versionMatch = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
const majorMinor = versionMatch ? `${versionMatch[1]}.${versionMatch[2]}` : '';

if (!map.specifications.some((entry) => entry.majorMinor === majorMinor)) {
  throw new Error(`No specification document is mapped to release series ${majorMinor || version}`);
}

if (eventName === 'push' && tagName !== `v${version}`) {
  throw new Error(`Tag ${tagName} does not match resolved version ${version}`);
}

console.log(`version=${version}`);
console.log(`tag=v${version}`);
