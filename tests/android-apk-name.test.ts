import {expect, it} from 'vitest';
// @ts-expect-error Build tooling uses plain JavaScript modules.
import {apkName} from '../scripts/android-apk-name.mjs';

const badging = "package: name='app.typealot.editor' versionCode='1' versionName='1.0.0'\nminSdkVersion:'29'\n";

it('names an architecture independent APK using its version and minimum Android', () => {
    expect(apkName(badging).name).toBe('Typealot_universal_android10+_1.0.0.apk');
    expect(apkName(badging.replace("'1.0.0'", "'2.3.4'").replace("'29'", "'35'")).name)
        .toBe('Typealot_universal_android15+_2.3.4.apk');
});

it('labels native and ABI-filtered APKs with their actual architectures', () => {
    expect(apkName(badging + "native-code: 'arm64-v8a' 'armeabi-v7a'\n").name)
        .toBe('Typealot_arm64-v8a+armeabi-v7a_android10+_1.0.0.apk');
    expect(apkName(badging, [{filterType: 'ABI', value: 'x86_64'}]).name)
        .toBe('Typealot_x86_64_android10+_1.0.0.apk');
});

it('rejects split APKs and unknown filter types instead of calling them universal', () => {
    expect(() => apkName(badging.replace('versionCode=', "split='config.en' versionCode="))).toThrow('split APK');
    expect(() => apkName(badging, [{filterType: 'DENSITY', value: 'hdpi'}])).toThrow('filter');
    expect(() => apkName(badging + 'native-code: \n')).toThrow('architectures');
});
