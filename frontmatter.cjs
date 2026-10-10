'use strict';

const REQUIRED_FIELDS = ['$schema', 'title', 'version', 'status', 'date', 'lastmod', 'javaversion', 'revision'];
const SERIES_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseFrontMatter(markdown, source = 'document') {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match) {
    throw new Error(`${source} must start with YAML front matter`);
  }

  const metadata = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^(\$?[A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$/.exec(line);
    if (!field) {
      throw new Error(`Unsupported front matter in ${source}: ${line}`);
    }

    const [, key, rawValue] = field;
    let value = rawValue;
    if (rawValue.startsWith("'") && rawValue.endsWith("'")) {
      value = rawValue.slice(1, -1).replaceAll("''", "'");
    } else if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
      try {
        value = JSON.parse(rawValue);
      } catch (error) {
        throw new Error(`Invalid quoted front matter field ${key} in ${source}`, { cause: error });
      }
    }

    if (key === 'revision' && /^(0|[1-9]\d*)$/.test(rawValue)) {
      value = Number(rawValue);
    }
    if (typeof value === 'string' && value.length === 0) {
      throw new Error(`Front matter field ${key} in ${source} must be a non-empty string`);
    }
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new Error(`Front matter field ${key} in ${source} must be a scalar`);
    }
    metadata[key] = value;
  }

  for (const field of REQUIRED_FIELDS) {
    if (!Object.hasOwn(metadata, field)) {
      throw new Error(`Missing front matter field ${field} in ${source}`);
    }
  }
  if (!SERIES_PATTERN.test(metadata.version)) {
    throw new Error(`Front matter version in ${source} must be major.minor (X.Y)`);
  }
  if (metadata.$schema !== '../schemas/frontmatter.schema.json') {
    throw new Error(`Front matter $schema in ${source} must link to ../schemas/frontmatter.schema.json`);
  }
  if (metadata.status !== 'draft' && metadata.status !== 'final') {
    throw new Error(`Front matter status in ${source} must be draft or final`);
  }
  for (const field of ['date', 'lastmod']) {
    if (!DATE_PATTERN.test(metadata[field])) {
      throw new Error(`Front matter ${field} in ${source} must use YYYY-MM-DD`);
    }
  }
  if (!/^\d+$/.test(metadata.javaversion)) {
    throw new Error(`Front matter javaversion in ${source} must be a Java version number`);
  }
  if (!Number.isSafeInteger(metadata.revision) || metadata.revision < 1) {
    throw new Error(`Front matter revision in ${source} must be a positive integer`);
  }

  return Object.freeze(metadata);
}

module.exports = { parseFrontMatter };
