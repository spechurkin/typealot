import {chromium} from '@playwright/test';
import {mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const svg = await readFile(path.join(root, 'public/knight.svg'), 'utf8');
const browser = await chromium.launch({
    headless: true,
    channel: process.env.ICON_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined)
});
try {
    const page = await browser.newPage();
    await page.evaluate(async source => {
        const image = new Image();
        image.src = source;
        await image.decode();
        window.iconSource = image;
    }, `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);

    async function png(width, height = width, scale = 1, background = null) {
        const encoded = await page.evaluate(({width, height, scale, background}) => {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (background) {
                ctx.fillStyle = background;
                ctx.fillRect(0, 0, width, height);
            }
            const size = Math.min(width, height) * scale;
            const image = window.iconSource;
            const imageHeight = size * image.naturalHeight / image.naturalWidth;
            ctx.drawImage(image, (width - size) / 2, (height - imageHeight) / 2, size, imageHeight);
            return canvas.toDataURL('image/png').split(',')[1];
        }, {width, height, scale, background});
        return Buffer.from(encoded, 'base64');
    }

    async function save(relative, data) {
        const target = path.join(root, relative);
        await mkdir(path.dirname(target), {recursive: true});
        await writeFile(target, data);
    }

    for (const size of [16, 32, 48, 180, 192, 512]) {
        await save(`public/icons/icon-${size}.png`, await png(size));
    }
    const sizes = [16, 24, 32, 48, 64, 128, 256];
    const frames = await Promise.all(sizes.map(size => png(size)));
    const header = Buffer.alloc(6 + sizes.length * 16);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(sizes.length, 4);
    let offset = header.length;
    frames.forEach((frame, index) => {
        const entry = 6 + index * 16;
        header[entry] = header[entry + 1] = sizes[index] % 256;
        header.writeUInt16LE(1, entry + 4);
        header.writeUInt16LE(32, entry + 6);
        header.writeUInt32LE(frame.length, entry + 8);
        header.writeUInt32LE(offset, entry + 12);
        offset += frame.length;
    });
    await save('public/favicon.ico', Buffer.concat([header, ...frames]));

    const resources = 'android/app/src/main/res';
    for (const [density, size] of Object.entries({mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192})) {
        for (const name of ['ic_launcher', 'ic_launcher_round']) {
            await save(`${resources}/mipmap-${density}/${name}.png`, await png(size));
        }
        // Android's adaptive mask keeps only the central 66 dp of its 108 dp layer.
        const foregroundSize = size * 108 / 48;
        await save(`${resources}/mipmap-${density}/ic_launcher_foreground.png`, await png(foregroundSize, foregroundSize, 64 / 108));
    }
    for (const directory of await readdir(path.join(root, resources))) {
        if (!directory.startsWith('drawable')) continue;
        const relative = `${resources}/${directory}/splash.png`;
        let previous;
        try {
            previous = await readFile(path.join(root, relative));
        } catch (error) {
            if (error.code === 'ENOENT') continue;
            throw error;
        }
        await save(relative, await png(previous.readUInt32BE(16), previous.readUInt32BE(20), 0.25, '#07232b'));
    }
    console.log('Generated browser, Windows and Android icons and Android splash screens from public/knight.svg.');
} finally {
    await browser.close();
}
