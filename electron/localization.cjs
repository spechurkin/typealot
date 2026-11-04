const fs = require('node:fs');
const path = require('node:path');

const directory = path.resolve(__dirname, '../src/locales');
const catalogs = new Map(fs.readdirSync(directory)
    .filter(name => /^[a-z]{2,3}(?:-[a-zA-Z0-9]+)*\.json$/.test(name))
    .map(name => [name.slice(0, -5), JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'))]));

function resolveLanguage(value) {
    if (typeof value !== 'string') return 'en';
    if (catalogs.has(value)) return value;
    const base = value.split('-')[0];
    return catalogs.has(base) ? base : 'en';
}

function t(language, key, params = {}) {
    const message = catalogs.get(resolveLanguage(language))[key] ?? catalogs.get('en')[key];
    if (typeof message !== 'string') return key;
    return message.replace(/\{(\w+)\}/g, (placeholder, name) =>
        Object.hasOwn(params, name) ? String(params[name]) : placeholder);
}

module.exports = {resolveLanguage, t};
