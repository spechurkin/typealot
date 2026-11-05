const fs = require('node:fs');

function verifyDesktopBinary(file, platform, arch) {
    const descriptor = fs.openSync(file, 'r');
    try {
        const header = Buffer.alloc(64);
        if (fs.readSync(descriptor, header, 0, header.length, 0) !== header.length) throw new Error('Truncated executable');
        let actual;
        if (platform === 'win32' && header.toString('ascii', 0, 2) === 'MZ') {
            const pe = Buffer.alloc(6);
            fs.readSync(descriptor, pe, 0, pe.length, header.readUInt32LE(60));
            if (pe.readUInt32LE(0) === 0x4550) actual = {332: 'ia32', 34404: 'x64'}[pe.readUInt16LE(4)];
        } else if (platform === 'linux' && header.toString('hex', 0, 4) === '7f454c46' && header[5] === 1) {
            actual = {62: 'x64', 183: 'arm64'}[header.readUInt16LE(18)];
        } else if (platform === 'darwin' && header.readUInt32LE(0) === 0xfeedfacf) {
            actual = {16777223: 'x64', 16777228: 'arm64'}[header.readUInt32LE(4)];
        }
        if (actual !== arch) throw new Error(`Wrong executable architecture in ${file}: expected ${platform}/${arch}, found ${actual || 'unknown'}`);
        return actual;
    } finally {
        fs.closeSync(descriptor);
    }
}

module.exports = {verifyDesktopBinary};
