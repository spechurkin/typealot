import {createRequire} from 'node:module';
import path from 'node:path';
import {expect, it} from 'vitest';

const require = createRequire(import.meta.url);
const {verifyDesktopBinary} = require('../../scripts/desktop/verify-desktop-binary.cjs');

it('checks the native executable and rejects the same binary for another architecture', () => {
    expect(verifyDesktopBinary(process.execPath, process.platform, process.arch)).toBe(process.arch);
    const other = process.arch === 'x64' ? (process.platform === 'win32' ? 'ia32' : 'arm64') : 'x64';
    expect(() => verifyDesktopBinary(process.execPath, process.platform, other)).toThrow('Wrong executable architecture');
    expect(() => verifyDesktopBinary(path.resolve('package.json'), process.platform, process.arch)).toThrow('Wrong executable architecture');
});
