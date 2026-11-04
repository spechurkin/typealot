import {createRequire} from 'node:module';
import {expect, it} from 'vitest';
import {type Language, locales, supportedLanguages, t, type TranslationKey} from '../src/i18n';

const native = createRequire(import.meta.url)('../electron/localization.cjs') as {
    resolveLanguage: (value: unknown) => Language;
    t: (language: string, key: string, params?: Record<string, string | number>) => string
};

it('shares native dialog messages with all registered application locales', () => {
    for (const language of supportedLanguages) {
        expect(native.resolveLanguage(language)).toBe(language);
        for (const key of Object.keys(locales[language].messages).filter(key => key.startsWith('desktop.')) as TranslationKey[])
            expect(native.t(language, key, {port: 47831, error: '$&'})).toBe(t(key, {
                port: 47831,
                error: '$&'
            }, language));
    }
    expect(native.resolveLanguage('ru-RU')).toBe('ru');
    expect(native.resolveLanguage('../../etc/passwd')).toBe('en');
    expect(native.resolveLanguage('constructor')).toBe('en');
});
