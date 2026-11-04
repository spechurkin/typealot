import {Extension} from '@tiptap/core';
import {Plugin, PluginKey} from '@tiptap/pm/state';
import {Decoration, DecorationSet, type EditorView} from '@tiptap/pm/view';

type Preview = { pos: number; label: string } | null;
const key = new PluginKey<Preview>('noteDropPreview');

export function setNoteDropPreview(view: EditorView, preview: Preview) {
    const previous = key.getState(view.state);
    if (previous?.pos === preview?.pos && previous?.label === preview?.label) return;
    view.dispatch(view.state.tr.setMeta(key, preview).setMeta('addToHistory', false));
}

export const NoteDropPreview = Extension.create({
    name: 'noteDropPreview',
    addProseMirrorPlugins() {
        return [new Plugin<Preview>({
            key,
            state: {
                init: () => null,
                apply: (tr, value) => tr.getMeta(key) !== undefined ? tr.getMeta(key)
                    : value ? {...value, pos: tr.mapping.map(value.pos)} : null
            },
            props: {
                decorations: state => {
                    const preview = key.getState(state);
                    if (!preview) return null;
                    return DecorationSet.create(state.doc, [Decoration.widget(preview.pos, () => {
                        const caret = document.createElement('span');
                        caret.className = 'note-drop-caret';
                        caret.setAttribute('aria-hidden', 'true');
                        const label = document.createElement('span');
                        label.className = 'note-drop-label';
                        label.textContent = `↗ ${preview.label}`;
                        caret.append(label);
                        return caret;
                    }, {side: -1, key: preview.label})]);
                }
            },
            view: view => {
                const clear = () => setNoteDropPreview(view, null);
                document.addEventListener('dragend', clear);
                return {destroy: () => document.removeEventListener('dragend', clear)};
            }
        })];
    }
});
