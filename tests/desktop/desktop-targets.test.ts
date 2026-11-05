import {createRequire} from 'node:module';
import {expect, it} from 'vitest';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {desktopTarget, localElectronDist} = require('../../scripts/desktop/desktop-targets.cjs');
const {GenericProvider} = require('electron-updater/out/providers/GenericProvider.js');
const {Arch} = require('electron-builder');

it('passes the distribution containing Electron.app to the macOS packager', () => {
    const distribution = path.resolve('node_modules/electron/dist');
    expect(localElectronDist(path.join(distribution, 'Electron.app/Contents/MacOS/Electron'), 'darwin')).toBe(distribution);
    expect(localElectronDist(path.join(distribution, 'electron.exe'), 'win32')).toBe(distribution);
    expect(localElectronDist(path.join(distribution, 'electron'), 'linux')).toBe(distribution);
});

it.each([
    ['--win', '--ia32', 'win32', 'ia32', 'latest-ia32', ['nsis']],
    ['--win', '--x64', 'win32', 'x64', 'latest', ['nsis']],
    ['--mac', '--x64', 'darwin', 'x64', 'latest-mac', ['dmg', 'zip']],
    ['--mac', '--arm64', 'darwin', 'arm64', 'latest-arm64-mac', ['dmg', 'zip']],
    ['--linux', '--x64', 'linux', 'x64', 'latest-linux', ['deb', 'AppImage']],
    ['--linux', '--arm64', 'linux', 'arm64', 'latest-linux-arm64', ['deb', 'AppImage']]
])('selects %s %s with independent update metadata', (osFlag, archFlag, platform, arch, channel, formats) => {
    const selected = desktopTarget([osFlag, archFlag], {platform: 'win32', arch: 'x64'});
    expect(selected).toMatchObject({platform, arch, output: `${platform}-${arch}`});
    const targets = [...selected.targets.values()][0];
    expect(targets.get(Arch[arch as string])).toEqual(formats);
    // Use the real updater provider to verify the channel written into app-update.yml.
    const previous = process.env.TEST_UPDATER_ARCH;
    process.env.TEST_UPDATER_ARCH = arch as string;
    try {
        const provider = new GenericProvider({url: 'https://example.com/', channel: selected.channel}, {}, {
            platform,
            executor: {}
        });
        expect(provider.channel).toBe(channel);
    } finally {
        if (previous === undefined) delete process.env.TEST_UPDATER_ARCH;
        else process.env.TEST_UPDATER_ARCH = previous;
    }
    expect(selected.useLocalElectron).toBe(platform === 'win32' && arch === 'x64');
});

it('uses native host defaults and rejects ambiguous or unsupported requests', () => {
    expect(desktopTarget([], {platform: 'darwin', arch: 'arm64'})).toMatchObject({
        platform: 'darwin',
        arch: 'arm64',
        useLocalElectron: true
    });
    for (const args of [['--mac', '--ia32'], ['--linux', '--ia32'], ['--win', '--mac'], ['--x64', '--ia32'], ['--all']]) {
        expect(() => desktopTarget(args)).toThrow();
    }
});
