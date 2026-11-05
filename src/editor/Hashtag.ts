import {Extension} from '@tiptap/core';
import {Plugin} from '@tiptap/pm/state';
import {Decoration, DecorationSet} from '@tiptap/pm/view';
import {hashtagsIn} from './hashtags';

export const Hashtag = Extension.create({
    name: 'hashtag',
    addProseMirrorPlugins() {
        return [new Plugin({
            props: {
                decorations(state) {
                    const decorations: Decoration[] = [];
                    state.doc.descendants((node, pos) => {
                        if (node.type.spec.code) return false;
                        if (!node.isTextblock) return;
                        let text = '';
                        node.forEach(child => {
                            text += child.isText && !child.marks.some(mark => ['link', 'code'].includes(mark.type.name))
                                ? child.text : '\ufffc'.repeat(child.nodeSize);
                        });
                        for (const tag of hashtagsIn(text)) {
                            decorations.push(Decoration.inline(pos + 1 + tag.from, pos + 1 + tag.to, {
                                nodeName: 'a', 'data-hashtag': tag.text,
                                href: `#tag/${encodeURIComponent(tag.text.slice(1))}`, tabindex: '0'
                            }));
                        }
                        return false;
                    });
                    return DecorationSet.create(state.doc, decorations);
                }
            }
        })];
    }
});
