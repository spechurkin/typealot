const {build} = require('electron-builder');
const path = require('node:path');
const fs = require('node:fs/promises');
const {verifyDesktopArchive} = require('./verify-desktop-archive.cjs');
const {prepareUpgradeInclude} = require('./nsis-upgrade-script.cjs');
const {desktopMetadata, linuxMenu} = require('./desktop-menu.cjs');
const {desktopTarget} = require('./desktop-targets.cjs');
const {verifyDesktopBinary} = require('./verify-desktop-binary.cjs');

async function main() {
    if (!process.env.CSC_LINK?.trim()) delete process.env.CSC_LINK;
    const target = desktopTarget(process.argv.slice(2));
    const {releaseUrl} = await import('../../shared/updates.mjs');
    const publish = process.env.TYPEALOT_DESKTOP_UPDATE_URL
        ? {provider: 'generic', url: releaseUrl(process.env.TYPEALOT_DESKTOP_UPDATE_URL), channel: target.channel}
        : {
            provider: 'github',
            owner: 'spechurkin',
            repo: 'typealot',
            tagNamePrefix: 'desktop-',
            channel: target.channel
        };
    const root = path.resolve(__dirname, '../..');
    const release = path.join(root, 'release');
    await fs.mkdir(release, {recursive: true});
    const snapshot = await fs.mkdtemp(path.join(release, '.desktop-input-'));
    try {
        // ASAR offsets use file sizes collected before streaming; later edits would corrupt the archive.
        for (const name of ['dist', 'electron', 'shared', 'scripts', 'server', 'src/locales', 'package.json', 'package-lock.json']) {
            await fs.cp(path.join(root, name), path.join(snapshot, name), {recursive: true});
        }
        await fs.cp(path.join(root, 'node_modules'), path.join(snapshot, 'node_modules'), {recursive: true});
        const installerInclude = target.platform !== 'win32' ? undefined : await prepareUpgradeInclude(path.join(snapshot, 'nsis'), path.join(root, 'build/installer.nsh'));
        await build({
            targets: target.targets,
            config: {
                appId: 'app.typealot.editor',
                productName: 'Typealot',
                extraMetadata: desktopMetadata,
                artifactName: 'Typealot_${os}_${version}_${arch}.${ext}',
                npmRebuild: false,
                electronDist: target.useLocalElectron ? path.dirname(require('electron')) : undefined,
                directories: {
                    app: snapshot,
                    output: path.resolve(process.env.TYPEALOT_DESKTOP_OUTPUT || path.join(release, 'desktop', target.output))
                },
                afterPack: context => {
                    const binary = target.platform === 'darwin'
                        ? path.join(context.appOutDir, 'Typealot.app', 'Contents', 'MacOS', 'Typealot')
                        : path.join(context.appOutDir, target.platform === 'win32' ? 'Typealot.exe' : 'typealot');
                    verifyDesktopBinary(binary, target.platform, target.arch);
                    const checked = verifyDesktopArchive(path.join(context.packager.getResourcesDir(context.appOutDir), 'app.asar'));
                    console.log(`Verified desktop archive: ${checked} files`);
                },
                files: ['dist/**/*', 'electron/**/*', 'shared/**/*', 'scripts/**/*', 'server/**/*', 'src/locales/*.json', 'package.json', '!node_modules/@capacitor/android/**', '!node_modules/@capacitor/*/android/**', '!node_modules/cpu-features/**', '!node_modules/ssh2/lib/protocol/crypto/build/**'],
                win: {target: 'nsis', icon: 'public/favicon.ico'},
                nsis: {
                    artifactName: 'Typealot_Setup_${version}_${arch}.${ext}',
                    include: installerInclude,
                    oneClick: false,
                    allowToChangeInstallationDirectory: true,
                    createStartMenuShortcut: true,
                    shortcutName: 'Typealot',
                    uninstallDisplayName: 'Typealot',
                    installerIcon: 'public/favicon.ico',
                    uninstallerIcon: 'public/favicon.ico'
                },
                linux: linuxMenu,
                mac: {
                    target: ['dmg', 'zip'],
                    icon: 'public/icons/icon-512.png',
                    category: 'public.app-category.productivity',
                    minimumSystemVersion: '12.0.0'
                },
                deb: {
                    maintainer: 'Typealot (https://github.com/spechurkin/typealot)',
                    packageCategory: 'editors'
                },
                publish: [publish]
            }, publish: 'never'
        });
    } finally {
        if (path.dirname(path.resolve(snapshot)) !== release) throw new Error('Invalid desktop snapshot path');
        await fs.rm(snapshot, {recursive: true, force: true});
    }
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
