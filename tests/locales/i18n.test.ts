import {afterEach, expect, it} from 'vitest';
import {readdirSync, readFileSync} from 'node:fs';
import ts from 'typescript';
import {
    errorText,
    formatDate,
    formatNumber,
    getLanguage,
    isLanguage,
    locales,
    LocalizedError,
    setLanguage,
    supportedLanguages,
    t
} from '../../src/locales/i18n';
import {initialWorkspace} from '../../src/storage/model';
import type {MessageCatalog, MessageValue, TranslationKey} from '../../src/locales';

afterEach(() => setLanguage('ru'));
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
const variants = (message: MessageValue) => typeof message === 'string' ? [message] : Object.values(message);

it('uses stable keys and substitutes user data only in named parameters', () => {
    setLanguage('en');
    expect(t('nav.settings')).toBe('Settings');
    expect(t('folders.createNoteIn', {name: 'Настройки'})).toBe('Create note in Настройки');
    expect(t('attachments.downloadNamed', {name: '$& {count}.txt'})).toBe('Download $& {count}.txt');
    expect(errorText(new Error('Настройки'))).toBe('Настройки');
    expect(errorText(new LocalizedError('errors.syncWriteHttp', {status: 503}))).toBe('Could not upload changes: HTTP 503');
    setLanguage('ru');
    expect(t('nav.settings')).toBe('Настройки');
    expect(errorText(new LocalizedError('errors.syncWriteHttp', {status: 503}))).toBe('Не удалось отправить изменения: HTTP 503');
});

export function checkTranslationTypes() {
    // @ts-expect-error UI text is not a translation key.
    t('Настройки');
    // @ts-expect-error Unknown keys must fail the TypeScript build.
    t('settings.missingKey');
}

it('validates every registered catalog, including interpolation and plural forms', () => {
    const base: MessageCatalog = locales.ru.messages;
    for (const language of supportedLanguages) {
        const catalog: MessageCatalog = locales[language].messages;
        expect(Object.keys(catalog).sort()).toEqual(Object.keys(base).sort());
        for (const key of Object.keys(base) as TranslationKey[]) {
            expect(key).toMatch(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/);
            const value = catalog[key];
            expect(typeof value).toBe(typeof base[key]);
            if (typeof value !== 'string') expect(value.other).toBeTruthy();
            for (const text of variants(value)) {
                expect(text?.trim(), `${language}:${key}`).toBeTruthy();
                expect(placeholders(text!)).toEqual(placeholders(variants(base[key])[0]!));
            }
        }
    }
});

it('keeps message identity independent from the Russian wording', () => {
    const original = locales.ru.messages['nav.settings'];
    try {
        locales.ru.messages['nav.settings'] = 'Параметры приложения';
        expect(t('nav.settings', {}, 'ru')).toBe('Параметры приложения');
        expect(t('nav.settings', {}, 'en')).toBe('Settings');
    } finally {
        locales.ru.messages['nav.settings'] = original;
    }
});

it('uses locale-specific plurals and Intl formatting', () => {
    setLanguage('ru');
    for (const [count, expected] of [[1, '1 заметка'], [2, '2 заметки'], [5, '5 заметок'], [21, '21 заметка'], [1.5, '1.5 заметки']] as const)
        expect(t('backups.noteCount', {count})).toBe(expected);
    setLanguage('en');
    expect(t('backups.noteCount', {count: 1})).toBe('1 note');
    expect(t('backups.noteCount', {count: 5})).toBe('5 notes');
    expect(formatNumber(1234.5)).toBe(new Intl.NumberFormat('en-US').format(1234.5));
    expect(formatDate(0, {year: 'numeric', month: 'long', timeZone: 'UTC'})).toBe('January 1970');
});

it('validates locale codes and leaves an existing workspace unchanged', () => {
    expect(isLanguage('constructor')).toBe(false);
    expect(isLanguage('xx')).toBe(false);
    for (const language of supportedLanguages) expect(isLanguage(language)).toBe(true);
    setLanguage('ru');
    const workspace = initialWorkspace(), before = JSON.stringify(workspace);
    setLanguage('en');
    expect(getLanguage()).toBe('en');
    expect(JSON.stringify(workspace)).toBe(before);
    expect(initialWorkspace().notes[0].title).toBe('Room for your thoughts');
});

it('requires explicit keyed calls in source without automatic text rewriting', () => {
    const violations: string[] = [];
    for (const file of readdirSync('src', {recursive: true}).map(String).filter(name => /\.tsx?$/.test(name) && name.replaceAll('\\', '/') !== 'locales/index.ts')) {
        const source = ts.createSourceFile(file, readFileSync(`src/${file}`, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const walk = (node: ts.Node) => {
            if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) && /[А-Яа-яЁё]/.test(node.text))
                violations.push(`${file}:${node.text}`);
            if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't' && node.arguments[0] && ts.isStringLiteral(node.arguments[0]))
                expect(Object.hasOwn(locales.ru.messages, node.arguments[0].text), `${file}:${node.arguments[0].text}`).toBe(true);
            ts.forEachChild(node, walk);
        };
        walk(source);
    }
    expect(violations).toEqual([]);
    expect(readFileSync('vite.config.ts', 'utf8')).not.toContain('i18n-plugin');
});
