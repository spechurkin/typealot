const asar = require('@electron/asar');
const {createHash} = require('node:crypto');

function verifyDesktopArchive(archive) {
    let checked = 0;
    for (const entry of asar.listPackage(archive)) {
        const name = entry.replace(/^[/\\]/, '');
        const stat = asar.statFile(archive, name);
        if (!stat.integrity) continue;
        const contents = asar.extractFile(archive, name);
        const hash = createHash('sha256').update(contents).digest('hex');
        if (contents.length !== stat.size || hash !== stat.integrity.hash) {
            throw new Error(`Desktop archive integrity check failed: ${name}`);
        }
        checked++;
    }
    const pkg = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
    asar.extractFile(archive, pkg.main);
    for (const entry of asar.listPackage(archive)) {
        const name = entry.replace(/\\/g, '/').replace(/^\//, '');
        if (/^src\/locales\/[^/]+\.json$/.test(name)) {
            JSON.parse(asar.extractFile(archive, entry.slice(1)).toString('utf8'));
        }
    }
    if (!checked) throw new Error('Desktop archive has no file integrity records');
    return checked;
}

module.exports = {verifyDesktopArchive};
