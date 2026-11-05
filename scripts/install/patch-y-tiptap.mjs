import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

const directory = path.resolve(import.meta.dirname, '../../node_modules/@tiptap/y-tiptap');
const {version} = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
if (version !== '3.1.0') throw Error(`Review the selection repair for @tiptap/y-tiptap@${version}.`);

// A CRDT rerender can leave the old cursor at a block boundary, outside inline content.
for (const name of ['dist/index.js', 'dist/index.cjs', 'src/lib/utils/binding/ProsemirrorBinding.ts']) {
    const filename = path.join(directory, name);
    const source = await readFile(filename, 'utf8');
    const before = 'TextSelection.create(tr.doc, clampedAnchor, clampedHead)';
    const after = 'TextSelection.between(tr.doc.resolve(clampedAnchor), tr.doc.resolve(clampedHead))';
    if (source.includes(after)) continue;
    if (source.split(before).length !== 2) throw Error(`Unexpected selection restoration in ${filename}.`);
    await writeFile(filename, source.replace(before, after));
}
