import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import frontMatter from '../frontmatter.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {parseFrontMatter} = frontMatter;

function failSelection(message) {
    if (process.env.GITHUB_ACTIONS === 'true') {
        const annotation = message.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
        console.error(`::error title=Specification selection failed::${annotation}`);
    }
    throw new Error(message);
}

const documentNames = (await readdir(path.join(root, 'documents')))
    .filter((file) => file.endsWith('.md'))
    .sort();
const documents = await Promise.all(documentNames.map(async (name) => {
    const file = path.join('documents', name);
    const contents = await readFile(path.join(root, file), 'utf8');
    return {file, name, metadata: parseFrontMatter(contents, file)};
}));
const compareVersions = (left, right) => {
    const [leftMajor, leftMinor, leftPatch] = left.split('.').map(Number);
    const [rightMajor, rightMinor, rightPatch] = right.split('.').map(Number);
    return leftMajor - rightMajor || leftMinor - rightMinor || leftPatch - rightPatch;
};
const finalVersions = documents
    .filter(({metadata}) => metadata.status === 'final')
    .map(({metadata}) => metadata.version)
    .sort(compareVersions);
if (!finalVersions.length) failSelection('The documents folder must contain at least one final specification');

const explicitVersion = process.env.INPUT_VERSION?.trim();
const inputStatus = process.env.INPUT_STATUS?.trim() ?? '';
const eventName = process.env.EVENT_NAME;
const tagName = process.env.TAG_NAME ?? '';
let version;
let status;
if (eventName === 'push') {
    const tag = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:-([a-z][a-z0-9-]*))?$/.exec(tagName);
    if (!tag) failSelection(`Tag ${tagName || '(empty)'} must use vX.Y.Z with an optional -status suffix`);
    version = tag[1];
    status = tag[2] ?? 'final';
    if (status === 'final') failSelection('Final releases omit the -final tag suffix');
} else {
    const noManualInput = !explicitVersion && !inputStatus;
    version = noManualInput ? finalVersions.at(-1) : explicitVersion || finalVersions.at(-1);
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
        failSelection(`Specification release must use X.Y.Z; received: ${version || '(empty)'}`);
    }
    status = noManualInput ? 'final' : inputStatus.replace(/^-/, '') || 'final';
    if (!/^[a-z][a-z0-9-]*$/.test(status)) failSelection(`Invalid release status: ${status}`);
}

const documentsForVersion = documents.filter(({metadata}) => metadata.version === version);
if (!documentsForVersion.length) failSelection(`No specification document exists for version ${version}`);
const selected = documentsForVersion.find(({metadata}) => metadata.status === status);
if (!selected) {
    const availableStatuses = [...new Set(documentsForVersion.map(({metadata}) => metadata.status))].sort();
    failSelection(`No document exists for version ${version} with status '${status}'. Available statuses: ${availableStatuses.join(', ')}`);
}
const expectedFile = `v${version}${status === 'final' ? '' : `-${status}`}.md`;
if (selected.name !== expectedFile) failSelection(`${selected.file} must be named documents/${expectedFile} for its version and status`);
const suffix = status === 'final' ? '' : `-${status}`;
const tag = `v${version}${suffix}`;
if (eventName === 'push' && tagName !== tag) failSelection(`Tag ${tagName} does not match resolved specification version ${version}${suffix}`);

const packageVersion = `${version}${suffix}`;
const pdfVersion = packageVersion;
console.log(`version=${packageVersion}`);
console.log(`specification_version=${version}`);
console.log(`status=${status}`);
console.log(`pdf_version=${pdfVersion}`);
console.log(`tag=${tag}`);
