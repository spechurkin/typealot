import {execFileSync} from 'node:child_process';
import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';

export function apkName(badging, filters = []) {
    const version = badging.match(/^package:.*\bversionName='([^']+)'/m)?.[1];
    const api = Number(badging.match(/^(?:minSdkVersion|sdkVersion):'([0-9]+)'/m)?.[1]);
    if (!version || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version) || !api) {
        throw Error('APK versionName or minSdkVersion is missing or unsupported');
    }
    if (/^package:.*\bsplit='/m.test(badging)) throw Error('A split APK cannot be published as a standalone APK');
    const nativeCode = badging.match(/^native-code:\s*(.*)$/m);
    const abis = nativeCode ? [...nativeCode[1].matchAll(/'([^']+)'/g)].map(match => match[1]) : [];
    for (const filter of filters) {
        if (filter.filterType !== 'ABI') throw Error(`Unsupported APK filter: ${filter.filterType}`);
        abis.push(filter.value);
    }
    if (nativeCode && !abis.length) throw Error('Cannot determine APK native architectures');
    const architecture = abis.length ? [...new Set(abis)].sort().join('+') : 'universal';
    if (!/^[A-Za-z0-9_+.-]+$/.test(architecture)) throw Error('Invalid APK architecture');
    const androidVersions = {29: '10', 30: '11', 31: '12', 32: '12L', 33: '13', 34: '14', 35: '15', 36: '16'};
    const minimum = androidVersions[api] ? `android${androidVersions[api]}` : `api${api}`;
    return {name: `Typealot_${architecture}_${minimum}+_${version}.apk`, version};
}

export async function inspectApk(apk, root, filters) {
    let sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    if (!sdk) {
        const properties = await readFile(path.join(root, 'android/local.properties'), 'utf8');
        sdk = properties.match(/^sdk\.dir\s*=\s*(.+)$/m)?.[1].trim().replace(/\\([\\:= ])/g, '$1');
    }
    if (!sdk) throw Error('Set ANDROID_HOME to the Android SDK directory');
    const tools = path.join(sdk, 'build-tools');
    const versions = (await readdir(tools)).filter(version => /^\d+\.\d+\.\d+$/.test(version))
        .sort((a, b) => a.localeCompare(b, 'en', {numeric: true}));
    if (!versions.length) throw Error('Android SDK Build Tools are required to inspect the APK');
    const aapt = path.join(tools, versions.at(-1), process.platform === 'win32' ? 'aapt2.exe' : 'aapt2');
    const badging = execFileSync(aapt, ['dump', 'badging', apk], {encoding: 'utf8'});
    return apkName(badging, filters);
}
