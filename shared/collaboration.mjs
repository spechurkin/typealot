import * as Y from 'yjs';
import {prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON} from '@tiptap/y-tiptap';
import {sha256} from '@noble/hashes/sha2.js';

export const canonical = value => JSON.stringify(normalize(value));

function normalize(value) {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]));
    return value;
}

export const generationOf = note => Array.from(sha256(new TextEncoder().encode(canonical({
    id: note.id,
    title: note.title,
    content: note.content
}))), b => b.toString(16).padStart(2, '0')).join('');

export function encode(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    return btoa(binary);
}

export const decode = text => Uint8Array.from(atob(text), char => char.charCodeAt(0));

export function createNoteDocument(note, schema) {
    const doc = new Y.Doc();
    const generation = note.collaboration?.generation || generationOf(note);
    if (note.collaboration) Y.applyUpdate(doc, decode(note.collaboration.state));
    else {
        const clientID = doc.clientID;
        doc.clientID = parseInt(generation.slice(0, 8), 16) || 1;
        doc.transact(() => {
            doc.getText('title').insert(0, note.title);
            prosemirrorJSONToYXmlFragment(schema, note.content, doc.getXmlFragment('content'));
        }, 'seed');
        doc.clientID = clientID;
    }
    return {doc, generation};
}

export function noteSnapshot(note, doc, generation) {
    return {
        ...note,
        title: doc.getText('title').toString(),
        content: yXmlFragmentToProsemirrorJSON(doc.getXmlFragment('content')),
        collaboration: {generation, state: encode(Y.encodeStateAsUpdate(doc))}
    };
}

export function mergeNotes(local, remote) {
    if (!local.collaboration || !remote.collaboration || local.collaboration.generation !== remote.collaboration.generation) return null;
    const doc = new Y.Doc();
    try {
        Y.applyUpdate(doc, decode(remote.collaboration.state));
        Y.applyUpdate(doc, decode(local.collaboration.state));
        return noteSnapshot({
            ...remote,
            updatedAt: Math.max(local.updatedAt, remote.updatedAt)
        }, doc, remote.collaboration.generation);
    } finally {
        doc.destroy();
    }
}

export function replaceText(text, value, origin) {
    const previous = text.toString();
    if (previous === value) return;
    let prefix = 0, suffix = 0;
    while (prefix < previous.length && prefix < value.length && previous[prefix] === value[prefix]) prefix++;
    if (prefix > 0 && /^[\uD800-\uDBFF]$/.test(previous[prefix - 1]) && /^[\uDC00-\uDFFF]$/.test(previous[prefix] || '')) prefix--;
    while (suffix < previous.length - prefix && suffix < value.length - prefix && previous[previous.length - 1 - suffix] === value[value.length - 1 - suffix]) suffix++;
    const boundary = previous.length - suffix;
    if (suffix > 0 && /^[\uD800-\uDBFF]$/.test(previous[boundary - 1] || '') && /^[\uDC00-\uDFFF]$/.test(previous[boundary] || '')) suffix--;
    text.doc.transact(() => {
        if (previous.length - prefix - suffix) text.delete(prefix, previous.length - prefix - suffix);
        if (value.length - prefix - suffix) text.insert(prefix, value.slice(prefix, value.length - suffix));
    }, origin);
}

export function assertDocument(content) {
    const nodes = new Set(['doc', 'paragraph', 'heading', 'text', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'codeBlock', 'hardBreak', 'horizontalRule', 'image', 'table', 'tableRow', 'tableCell', 'tableHeader', 'media', 'callout', 'toc', 'noteLink', 'attachment']);
    const marks = new Set(['bold', 'italic', 'underline', 'strike', 'link', 'textStyle', 'highlight', 'code']);
    let count = 0;
    const walk = (node, depth) => {
        if (!node || !nodes.has(node.type) || depth > 64 || ++count > 100000) throw Error('Invalid document');
        if (node.text !== undefined && typeof node.text !== 'string') throw Error('Invalid text');
        if (node.type === 'image' && (typeof node.attrs?.src !== 'string' || !(/^(data:image\/(png|jpeg|gif|webp);base64,|https:\/\/)/.test(node.attrs.src)))) throw Error('Invalid image');
        if (node.type === 'attachment' && (typeof node.attrs?.name !== 'string' || typeof node.attrs?.data !== 'string' || !node.attrs.data.startsWith('data:'))) throw Error('Invalid attachment');
        if (node.type === 'media') {
            const media = node.attrs, url = new URL(media.canonicalUrl);
            if (url.protocol !== 'https:' || url.username || url.password || url.port) throw Error('Invalid media');
            if (media.provider === 'youtube') {
                if (!['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(url.hostname) || !/^[\w-]{10,100}$/.test(media.externalId)) throw Error('Invalid media');
            } else if (media.provider === 'spotify') {
                if (url.hostname !== 'open.spotify.com' || !['track', 'album', 'playlist', 'artist', 'show', 'episode'].includes(media.contentType) || !/^[A-Za-z0-9]{22}$/.test(media.externalId)) throw Error('Invalid media');
            } else throw Error('Invalid media');
        }
        for (const mark of node.marks || []) {
            if (!marks.has(mark.type)) throw Error('Invalid mark');
            if (mark.type === 'link' && !['https:', 'http:', 'mailto:'].includes(new URL(mark.attrs?.href).protocol)) throw Error('Invalid link');
        }
        if (node.content) {
            if (!Array.isArray(node.content)) throw Error('Invalid children');
            node.content.forEach(child => walk(child, depth + 1));
        }
    };
    if (content?.type !== 'doc') throw Error('Invalid root');
    walk(content, 0);
}

export function assertCollaboration(note) {
    const state = note.collaboration;
    if (!state) return;
    if (typeof state.generation !== 'string' || !/^[a-f0-9]{64}$/.test(state.generation) || typeof state.state !== 'string' || state.state.length > 210000000) throw Error('Invalid collaboration state');
    const doc = new Y.Doc();
    try {
        Y.applyUpdate(doc, decode(state.state));
        const snapshot = noteSnapshot(note, doc, state.generation);
        assertDocument(snapshot.content);
        if (snapshot.title !== note.title || canonical(snapshot.content) !== canonical(note.content)) throw Error('Mismatched collaboration state');
    } finally {
        doc.destroy();
    }
}
