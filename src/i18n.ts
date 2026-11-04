import {useSyncExternalStore} from 'react';
import {defaultLanguage, isLanguage, type Language, locales, type MessageCatalog, type TranslationKey} from './locales';

export {isLanguage, locales, supportedLanguages} from './locales';
export type {Language, TranslationKey} from './locales';
export type TranslationParams = Record<string, string | number>;
export type DisplayError = Error | string;
let language: Language = defaultLanguage;
try {
    const saved = localStorage.getItem('typealot.language');
    if (isLanguage(saved)) language = saved;
} catch {
}
const updateDocumentLanguage = () => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = language;
    document.documentElement.dir = locales[language].direction;
};
updateDocumentLanguage();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

export function getLanguage(): Language {
    return language;
}

export function setLanguage(next: Language) {
    if (!isLanguage(next)) return;
    language = next;
    try {
        localStorage.setItem('typealot.language', next);
    } catch {
    }
    updateDocumentLanguage();
    listeners.forEach(fn => fn());
}

export function useLanguage(): Language {
    return useSyncExternalStore(subscribe, getLanguage, () => defaultLanguage);
}

export function t(key: TranslationKey, params: TranslationParams = {}, locale: Language = language): string {
    const catalog: MessageCatalog = locales[locale].messages;
    const value = catalog[key];
    const template = typeof value === 'string' ? value :
        value[new Intl.PluralRules(locales[locale].intlLocale).select(Number(params.count))] ?? value.other;
    return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
        Object.hasOwn(params, name) ? String(params[name]) : placeholder);
}

export function isTranslationKey(value: string): value is TranslationKey {
    return Object.hasOwn(locales[defaultLanguage].messages, value);
}

export function formatDate(value: Date | number, options: Intl.DateTimeFormatOptions = {
    dateStyle: 'medium',
    timeStyle: 'short'
}, locale: Language = language): string {
    return new Intl.DateTimeFormat(locales[locale].intlLocale, options).format(value);
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions, locale: Language = language): string {
    return new Intl.NumberFormat(locales[locale].intlLocale, options).format(value);
}

export class LocalizedError extends Error {
    constructor(readonly key: TranslationKey, readonly params: TranslationParams = {}) {
        super(key);
        this.name = 'LocalizedError';
    }
}

export function errorText(error: unknown): string {
    if (error instanceof LocalizedError) return t(error.key, error.params);
    const message = error instanceof Error ? error.message : String(error);
    if (isTranslationKey(message)) return t(message);
    return message;
}

export function toError(error: unknown): DisplayError {
    return error instanceof Error ? error : String(error);
}
