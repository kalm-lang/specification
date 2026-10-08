'use strict';

const fs = require('node:fs');
const path = require('node:path');
const map = require('./specification-map.json');

const specifications = map.specifications;

function listSpecifications({ includeDrafts = false } = {}) {
  if (typeof includeDrafts !== 'boolean') {
    throw new TypeError('includeDrafts must be a boolean');
  }

  return specifications
    .filter((entry) => includeDrafts || entry.status === 'final')
    .map(({ majorMinor, specificationVersion, status, file }) => ({
      majorMinor,
      specificationVersion,
      status,
      file,
    }));
}

function getSpecification(version, { status = 'final' } = {}) {
  if (typeof version !== 'string') {
    throw new TypeError('version must be a string');
  }

  if (status !== 'final' && status !== 'draft') {
    throw new TypeError(`Unsupported specification status: ${status}`);
  }

  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  const majorMinor = match ? `${match[1]}.${match[2]}` : '';
  const entry = specifications.find((candidate) =>
    candidate.majorMinor === majorMinor && candidate.status === status);
  if (!entry) {
    throw new RangeError(`No ${status} Kalm specification is mapped to version ${version}`);
  }

  return fs.readFileSync(path.join(__dirname, entry.file), 'utf8');
}

module.exports = {
  latestVersion: map.latest ?? map.latestSpecification,
  listSpecifications,
  getSpecification,
};
