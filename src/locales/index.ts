import ru from './ru.json' with {type: 'json'};
import en from './en.json' with {type: 'json'};

export type TranslationKey = keyof typeof ru;
export type PluralMessage = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
export type MessageValue = string | PluralMessage;
export type MessageCatalog = Record<TranslationKey, MessageValue>;
type LocaleDefinition = {
    nativeName: string;
    intlLocale: string;
    direction: 'ltr' | 'rtl';
    messages: MessageCatalog;
};

export const locales = {
    ru: {nativeName: 'Русский', intlLocale: 'ru-RU', direction: 'ltr', messages: ru},
    en: {nativeName: 'English', intlLocale: 'en-US', direction: 'ltr', messages: en}
} satisfies Record<string, LocaleDefinition>;

export type Language = keyof typeof locales;
export const defaultLanguage: Language = 'en';
export const supportedLanguages = Object.keys(locales) as Language[];
export const isLanguage = (value: unknown): value is Language =>
    typeof value === 'string' && Object.hasOwn(locales, value);
