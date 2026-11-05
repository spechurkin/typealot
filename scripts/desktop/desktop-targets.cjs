const {Arch, Platform} = require('electron-builder');

const platforms = {win32: Platform.WINDOWS, darwin: Platform.MAC, linux: Platform.LINUX};
const supported = {win32: ['ia32', 'x64'], darwin: ['x64', 'arm64'], linux: ['x64', 'arm64']};
const formats = {win32: ['nsis'], darwin: ['dmg', 'zip'], linux: ['deb', 'AppImage']};

function desktopTarget(args, host = {platform: process.platform, arch: process.arch}) {
    let platform = host.platform, arch = host.arch;
    let platformSet = false, archSet = false;
    for (const argument of args) {
        const selected = {'--win': 'win32', '--mac': 'darwin', '--linux': 'linux'}[argument];
        if (selected) {
            if (platformSet) throw new Error('Choose one desktop platform per build');
            platform = selected;
            platformSet = true;
        } else if (['--ia32', '--x64', '--arm64'].includes(argument)) {
            if (archSet) throw new Error('Choose one desktop architecture per build');
            arch = argument.slice(2);
            archSet = true;
        } else {
            throw new Error(`Unknown desktop build argument: ${argument}`);
        }
    }
    if (!supported[platform]?.includes(arch)) throw new Error(`Unsupported desktop target: ${platform}/${arch}`);
    const channel = (platform === 'win32' && arch === 'ia32') || (platform === 'darwin' && arch === 'arm64')
        ? `latest-${arch}` : 'latest';
    return {
        platform, arch, channel,
        output: `${platform}-${arch}`,
        targets: platforms[platform].createTarget(formats[platform], Arch[arch]),
        useLocalElectron: platform === host.platform && arch === host.arch
    };
}

module.exports = {desktopTarget};
