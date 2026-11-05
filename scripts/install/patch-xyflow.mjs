import {readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';

const directory = path.resolve(import.meta.dirname, '../../node_modules/@xyflow/react');
const {version} = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
if (version !== '12.12.1') throw Error(`Review the ResizeObserver patch before upgrading @xyflow/react (${version}).`);

const marker = '/* Typealot: schedule flow resize delivery outside layout. */';
const scheduledObserver = `${marker} (class extends ResizeObserver {
    #timer = 0;
    #pending = new Map();
    constructor(callback) {
        super((entries, observer) => {
            for (const entry of entries) this.#pending.set(entry.target, entry);
            clearTimeout(this.#timer);
            this.#timer = setTimeout(() => {
                const pending = Array.from(this.#pending.values());
                this.#pending.clear();
                if (pending.length) callback(pending, observer);
            }, 0);
        });
    }
    unobserve(target) {
        this.#pending.delete(target);
        super.unobserve(target);
    }
    disconnect() {
        clearTimeout(this.#timer);
        this.#pending.clear();
        super.disconnect();
    }
})`;

for (const [name, count] of [['dist/esm/index.js', 2], ['dist/esm/index.mjs', 2], ['dist/umd/index.js', 3]]) {
    const filename = path.join(directory, name);
    const source = await readFile(filename, 'utf8');
    if (source.includes(marker)) {
        if (source.split(marker).length - 1 !== count || /new ResizeObserver\(/.test(source)) {
            throw Error(`Incomplete @xyflow/react observer patch in ${name}.`);
        }
        continue;
    }
    if ((source.match(/new ResizeObserver\(/g) || []).length !== count) {
        throw Error(`Unexpected @xyflow/react observers in ${name}; patch was not applied.`);
    }
    await writeFile(filename, source.replace(/new ResizeObserver\(/g, () => `new ${scheduledObserver}(`));
}
await rm(path.resolve(import.meta.dirname, '../../node_modules/.vite'), {recursive: true, force: true});
console.log('Applied @xyflow/react ResizeObserver scheduling patch.');
