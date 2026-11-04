const {spawn} = require('node:child_process');
const path = require('node:path');

function transform(data, decrypt) {
    const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; ` +
        `$data=[Convert]::FromBase64String([Console]::In.ReadToEnd()); ` +
        `$result=[Security.Cryptography.ProtectedData]::${decrypt ? 'Unprotect' : 'Protect'}($data,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); ` +
        `[Console]::Out.Write([Convert]::ToBase64String($result))`;
    return new Promise((resolve, reject) => {
        const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
            windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
        });
        let output = '';
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error('Windows encryption timed out'));
        }, 20000);
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', value => {
            output += value;
        });
        child.stderr.resume();
        child.on('error', () => {
            clearTimeout(timer);
            reject(new Error('Windows encryption unavailable'));
        });
        child.stdin.on('error', () => {
        });
        child.on('close', code => {
            clearTimeout(timer);
            if (code !== 0 || !output.trim()) return reject(new Error('Windows encryption failed'));
            resolve(Buffer.from(output.trim(), 'base64'));
        });
        child.stdin.end(Buffer.from(data).toString('base64'));
    });
}

module.exports = {protect: data => transform(data, false), unprotect: data => transform(data, true)};
