# Language settings

Typealot is available in **English and Russian**. Switch languages in Settings without reopening the app.

## Choose your language

1. Open **Settings**.
2. Under **Appearance**, find **Interface language**.
3. Choose English or Russian.

The change takes effect immediately and is remembered on this device. You can choose a different language
on another device. New installations start in English.

Your folder names, notes, canvas labels, and attachments stay as you created them.
Changing the interface language does not translate your documents.

If you find a translation that needs fixing, include the language, where the text appears,
the current wording, and your suggested replacement when reporting it.

## Add your own translation

To add a language, edit a source copy of Typealot and rebuild it. Here is a German example.

1. Copy [en.json](../src/locales/en.json) to `src/locales/de.json`.
2. Translate the values. Keep every key and any placeholders such as `{name}` and `{count}`.
   These are example entries; keep the rest of the copied file too:

   ```json
   {
     "nav.settings": "Einstellungen",
     "settings.language": "Sprache der Benutzeroberfläche",
     "notes.create": "Neue Notiz",
     "folders.createNoteIn": "Notiz in {name} erstellen",
     "backups.noteCount": {
       "one": "{count} Notiz",
       "other": "{count} Notizen"
     }
   }
   ```

3. In [src/locales/index.ts](../src/locales/index.ts), add this import beside the existing imports:

   ```ts
   import de from './de.json' with {type: 'json'};
   ```

   Then add an entry inside the existing `locales` object:

   ```ts
   de: {nativeName: 'Deutsch', intlLocale: 'de-DE', direction: 'ltr', messages: de},
   ```

4. From the project folder, check the translation and build the app:

   ```sh
   npm run test:i18n
   npm run build
   ```

The language now appears in Settings. For a desktop package, run `npm run release:desktop` on your target system.
For languages written right to left, use `direction: 'rtl'` and check the layout.

Desktop dialogs use the same translation files. Android's WebView startup dialog uses separate resources:
copy [strings.xml](../android/app/src/main/res/values/strings.xml) into a new `values-de` folder beside `values`
and translate its text for the German Android build.

[Back to the user guide](../README.md)
