import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(import.meta.dirname, '..'), android = path.join(root, 'android');
const candidates = [process.env.JAVA_HOME, process.env.JDK_HOME];
for (const base of [path.join(os.homedir(), '.gradle', 'jdks'), path.join(os.homedir(), '.jdks'), 'C:/Program Files/Java', 'C:/Program Files/Eclipse Adoptium']) {
    try {
        for (const entry of await fs.readdir(base, {withFileTypes: true})) {
            if (entry.isDirectory()) candidates.push(path.join(base, entry.name), path.join(base, entry.name, 'Contents', 'Home'));
        }
    } catch {
    }
}
let jdk;
for (const candidate of candidates.filter(Boolean)) {
    try {
        const release = await fs.readFile(path.join(candidate, 'release'), 'utf8');
        if (/^JAVA_VERSION="21[.\"]/m.test(release)) {
            jdk = path.resolve(candidate);
            break;
        }
    } catch {
    }
}
if (!jdk) throw Error('Установите JDK 21 или загрузите его через Android Studio, затем повторите npm run android:prepare. Java/Kotlin-модули этого проекта собираются на JDK 21.');
await fs.mkdir(path.join(android, '.gradle'), {recursive: true});
const propertiesFile = path.join(android, '.gradle', 'config.properties');
let properties = '';
try {
    properties = await fs.readFile(propertiesFile, 'utf8');
} catch {
}
const property = `java.home=${jdk.replaceAll('\\', '/')}`;
properties = /^java\.home=.*$/m.test(properties) ? properties.replace(/^java\.home=.*$/m, property) : `${properties.trimEnd()}\n${property}\n`;
await fs.writeFile(propertiesFile, properties.trimStart());
await fs.mkdir(path.join(android, '.idea'), {recursive: true});
const gradleFile = path.join(android, '.idea', 'gradle.xml');
let gradle;
try {
    gradle = await fs.readFile(gradleFile, 'utf8');
} catch {
    gradle = '<?xml version="1.0" encoding="UTF-8"?>\n<project version="4"><component name="GradleSettings"><option name="linkedExternalProjectsSettings"><GradleProjectSettings><option name="externalProjectPath" value="$PROJECT_DIR$"/><option name="gradleJvm" value="#GRADLE_LOCAL_JAVA_HOME"/></GradleProjectSettings></option></component></project>\n';
}
gradle = /<option name="gradleJvm" value="[^"]*"\s*\/>/.test(gradle) ? gradle.replace(/<option name="gradleJvm" value="[^"]*"\s*\/>/g, '<option name="gradleJvm" value="#GRADLE_LOCAL_JAVA_HOME" />') : gradle.replace('<GradleProjectSettings>', '<GradleProjectSettings>\n<option name="gradleJvm" value="#GRADLE_LOCAL_JAVA_HOME" />');
await fs.writeFile(gradleFile, gradle);
console.log(`Android Studio Gradle JDK: ${jdk}\nOpen folder: ${android}`);
