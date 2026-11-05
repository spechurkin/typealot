import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
// Capacitor 8 ships legacy Gradle DSL, including in the generated Cordova module.
for (const [name, version, file] of [
    ['@capacitor/android', '8.6.0', 'capacitor/build.gradle'],
    ['@capacitor/filesystem', '8.1.5', 'android/build.gradle'],
    ['@capacitor/share', '8.0.3', 'android/build.gradle']
]) {
    const directory = path.join(root, 'node_modules', name);
    const installed = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')).version;
    if (installed !== version) throw Error(`Review the Gradle DSL migration for ${name}@${installed}.`);
    await migrate(path.join(directory, file));
}
for (const name of ['build.gradle', 'cordova.variables.gradle']) {
    await migrate(path.join(root, 'android/capacitor-cordova-android-plugins', name), true);
}

async function migrate(filename, optional = false) {
    let source;
    try {
        source = await readFile(filename, 'utf8');
    } catch (error) {
        if (optional && error.code === 'ENOENT') return;
        throw error;
    }
    const updated = source
        .replaceAll('project.hasProperty(', 'rootProject.ext.has(')
        .replace(/(?<![.\w])hasProperty\(/g, 'rootProject.ext.has(')
        .replaceAll('lintOptions {', 'lint {')
        .replace(/^(\s*)minSdkVersion (.+)$/gm, '$1minSdk = $2')
        .replace(/^(\s*)targetSdkVersion (.+)$/gm, '$1targetSdk = $2')
        .replace(/^\s*version(?:Code|Name) .+\r?\n/gm, '')
        .replace(/^(\s*)(testInstrumentationRunner|minifyEnabled|sourceCompatibility|targetCompatibility) (?![=])(.+)$/gm, '$1$2 = $3')
        .replace(/baseline file\((.+)\)/g, 'baseline = file($1)')
        .replace(/\s*flatDir\s*\{[^}]*\}/g, '');
    if (updated !== source) await writeFile(filename, updated);
}
