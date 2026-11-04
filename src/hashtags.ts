import type {JSONContent} from '@tiptap/core';

export function hashtagsIn(text: string) {
    return Array.from(text.matchAll(/(?<![\p{L}\p{N}\p{M}_/#])#[\p{L}\p{N}_][\p{L}\p{N}\p{M}_]*/gu), match => ({
        text: match[0], from: match.index!, to: match.index! + match[0].length
    }));
}

function tagText(node: JSONContent): string {
    if (node.type === 'codeBlock' || node.marks?.some(mark => ['code', 'link'].includes(mark.type))) return '\n';
    if (node.type === 'text') return node.text || '';
    if (!node.content) return '\n';
    return node.content.map(tagText).join(['paragraph', 'heading'].includes(node.type || '') ? '' : '\n');
}

export function matchesHashtag(content: JSONContent, query: string): boolean {
    const normalized = query.normalize('NFC').toLocaleLowerCase();
    return hashtagsIn(tagText(content)).some(tag => tag.text.normalize('NFC').toLocaleLowerCase() === normalized);
}
