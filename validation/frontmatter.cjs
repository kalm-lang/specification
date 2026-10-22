'use strict';

const schema = require('./frontmatter.schema.json');

function validateAgainstSchema(metadata, source) {
    const errors = [];
    for (const field of schema.required) {
        if (!Object.hasOwn(metadata, field)) errors.push(`missing required field ${field}`);
    }
    for (const [key, value] of Object.entries(metadata)) {
        const rule = schema.properties[key];
        if (!rule) {
            if (schema.additionalProperties?.type && !schema.additionalProperties.type.includes(value === null ? 'null' : typeof value)) {
                errors.push(`${key} must be a scalar`);
            }
            continue;
        }
        if (rule.const !== undefined && value !== rule.const) errors.push(`${key} must equal ${rule.const}`);
        if (rule.type === 'string' && typeof value !== 'string') errors.push(`${key} must be a string`);
        if (rule.type === 'string' && rule.minLength && value.length < rule.minLength) errors.push(`${key} must not be empty`);
        if (rule.type === 'string' && rule.pattern && !new RegExp(rule.pattern).test(value)) errors.push(`${key} has an invalid format`);
        if (rule.enum && !rule.enum.includes(value)) errors.push(`${key} must be one of ${rule.enum.join(', ')}`);
        if (rule.format === 'date') {
            const date = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
            if (!date || new Date(Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]))).toISOString().slice(0, 10) !== value) {
                errors.push(`${key} must be a date`);
            }
        }
    }
    if (errors.length) throw new Error(`Front matter in ${source} does not match validation/frontmatter.schema.json: ${errors.join('; ')}`);
}

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
                throw new Error(`Invalid quoted front matter field ${key} in ${source}`, {cause: error});
            }
        }

        if (typeof value === 'string' && value.length === 0) {
            throw new Error(`Front matter field ${key} in ${source} must be a non-empty string`);
        }
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
            throw new Error(`Front matter field ${key} in ${source} must be a scalar`);
        }
        metadata[key] = value;
    }

    validateAgainstSchema(metadata, source);

    return Object.freeze(metadata);
}

module.exports = {parseFrontMatter};
