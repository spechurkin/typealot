import {LocalizedError, t} from './i18n';
import {randomId} from './crypto';
import type {JSONContent} from '@tiptap/react';
import type {Edge, Node, Viewport} from '@xyflow/react';
import {safeMedia} from './media';
import {assertCollaboration} from '../shared/collaboration.mjs';

export type Note = {
    id: string;
    title: string;
    folderId: string | null;
    content: JSONContent;
    updatedAt: number;
    order?: number;
    collaboration?: { generation: string; state: string }
};
export type Folder = { id: string; name: string; parentId: string | null; order?: number };
export type Attachment = { id: string; name: string; mime: string; data: string };
export type Board = { id: string; title: string; nodes: Node[]; edges: Edge[]; viewport: Viewport };
export type Workspace = {
    version: 1;
    notes: Note[];
    folders: Folder[];
    boards: Board[];
    attachments: Attachment[];
    profile: { name: string; handle: string; show: boolean };
    theme: 'dark' | 'light';
    sidebar: boolean;
    sidebarWidth: number;
    markdown: boolean;
    syncState?: { server: string; base: Workspace; digest: string; etag: string }
};
export const uid = randomId;

export function textOf(node: JSONContent): string {
    if (node.type === 'media') return `[${node.attrs?.provider === 'youtube' ? 'YouTube' : 'Spotify'}]`;
    if (node.type === 'image') return t('document.imageSummary', {name: node.attrs?.alt || ''});
    if (node.type === 'attachment') return t('document.fileSummary', {name: node.attrs?.name || ''});
    return [node.text || '', ...(node.content || []).map(textOf)].join(' ');
}

export const emptyDoc = (): JSONContent => ({type: 'doc', content: [{type: 'paragraph'}]});

export function initialWorkspace(): Workspace {
    return {
        version: 1, theme: 'dark', sidebar: true, sidebarWidth: 260, markdown: false,
        profile: {name: t('welcome.author'), handle: '', show: true},
        folders: [{id: 'inbox', name: t('welcome.folder'), parentId: null}], attachments: [],
        notes: [{
            id: 'welcome', folderId: 'inbox', title: t('welcome.title'), updatedAt: Date.now(), content: {
                type: 'doc', content: [
                    {
                        type: 'paragraph',
                        content: [{type: 'text', text: t('welcome.intro')}]
                    },
                    {
                        type: 'paragraph',
                        content: [{
                            type: 'text',
                            text: t('welcome.editorHelp')
                        }]
                    },
                    {type: 'heading', attrs: {level: 2}, content: [{type: 'text', text: t('welcome.section')}]},
                    {
                        type: 'paragraph',
                        content: [{
                            type: 'text',
                            text: t('welcome.workspaceHelp')
                        }]
                    },
                    {
                        type: 'blockquote',
                        content: [{
                            type: 'paragraph',
                            content: [{
                                type: 'text',
                                text: t('welcome.quote')
                            }]
                        }]
                    },
                    {type: 'paragraph'}
                ]
            }
        }],
        boards: [{
            id: 'board',
            title: t('welcome.canvas'),
            nodes: [{
                id: 'card',
                type: 'object',
                position: {x: 100, y: 100},
                data: {kind: 'note', noteId: 'welcome'},
                style: {width: 300}
            }],
            edges: [],
            viewport: {x: 0, y: 0, zoom: 1}
        }]
    };
}

const nodeTypes = new Set(['doc', 'paragraph', 'heading', 'text', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'codeBlock', 'hardBreak', 'horizontalRule', 'image', 'table', 'tableRow', 'tableCell', 'tableHeader', 'media', 'callout', 'toc', 'noteLink', 'attachment']);

export function validateWorkspace(input: unknown): Workspace {
    const w = input as Workspace;
    if (!w || w.version !== 1 || !Array.isArray(w.notes) || !Array.isArray(w.boards) || !Array.isArray(w.attachments) || !Array.isArray(w.folders) || !w.profile) throw new LocalizedError('errors.invalidBackupFormat');
    if (typeof w.profile.name !== 'string' || typeof w.profile.handle !== 'string' || typeof w.profile.show !== 'boolean') throw new LocalizedError('errors.invalidProfile');
    const unique = (items: { id: string }[]) => {
        const ids = new Set<string>();
        for (const item of items) {
            if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) throw new LocalizedError('errors.duplicateOrInvalidIdentifier');
            ids.add(item.id);
        }
        return ids;
    };
    const folderIds = unique(w.folders);
    unique(w.notes);
    unique(w.boards);
    unique(w.attachments);
    const safeImage = (url: unknown) => typeof url === 'string' && (/^(data:image\/(png|jpeg|gif|webp);base64,)/.test(url) || /^https:\/\//.test(url));
    let count = 0;
    const walk = (n: JSONContent, depth = 0) => {
        if (depth > 64 || ++count > 100000) throw new LocalizedError('errors.documentTooComplex');
        if (!n || !nodeTypes.has(n.type || '')) throw new LocalizedError('errors.unknownBlockType');
        if (n.text !== undefined && typeof n.text !== 'string') throw new LocalizedError('errors.invalidText');
        if (n.attrs !== undefined && (!n.attrs || typeof n.attrs !== 'object' || Array.isArray(n.attrs))) throw new LocalizedError('errors.invalidBlockAttributes');
        if (n.type === 'media' && !safeMedia(n.attrs)) throw new LocalizedError('errors.unsafeOrInvalidMediaBlock');
        if (n.type === 'image' && !safeImage(n.attrs?.src)) throw new LocalizedError('errors.unsafeImage');
        if (n.type === 'attachment' && (typeof n.attrs?.name !== 'string' || typeof n.attrs?.data !== 'string' || !n.attrs.data.startsWith('data:'))) throw new LocalizedError('errors.invalidDocumentAttachment');
        if (n.marks) {
            if (!Array.isArray(n.marks)) throw new LocalizedError('errors.invalidFormatting');
            for (const mark of n.marks) {
                if (!['bold', 'italic', 'underline', 'strike', 'link', 'textStyle', 'highlight', 'code'].includes(mark.type)) throw new LocalizedError('errors.unknownFormatting');
                if (mark.type === 'link') {
                    try {
                        if (!['https:', 'http:', 'mailto:'].includes(new URL(mark.attrs?.href).protocol)) throw Error();
                    } catch {
                        throw new LocalizedError('errors.unsafeLink');
                    }
                }
            }
        }
        if (n.content) {
            if (!Array.isArray(n.content)) throw new LocalizedError('errors.invalidContent');
            n.content.forEach(child => walk(child, depth + 1));
        }
    };
    w.notes.forEach(n => {
        if (typeof n.id !== 'string' || typeof n.title !== 'string') throw new LocalizedError('errors.invalidNote');
        if (n.order !== undefined && !Number.isFinite(n.order)) throw new LocalizedError('errors.invalidNote');
        if (n.folderId !== null && !folderIds.has(n.folderId)) throw new LocalizedError('errors.noteFolderNotFound');
        if (n.content?.type !== 'doc') throw new LocalizedError('errors.invalidDocumentStructure');
        try {
            assertCollaboration(n);
        } catch {
            throw new LocalizedError('errors.invalidCollaboration');
        }
        walk(n.content);
    });
    w.folders.forEach(f => {
        if (typeof f.id !== 'string' || typeof f.name !== 'string') throw new LocalizedError('errors.invalidFolder');
        if (f.order !== undefined && !Number.isFinite(f.order)) throw new LocalizedError('errors.invalidFolder');
        if (f.parentId !== null && !folderIds.has(f.parentId)) throw new LocalizedError('errors.parentFolderNotFound');
    });
    for (const f of w.folders) {
        const seen = new Set([f.id]);
        let p = f.parentId;
        while (p) {
            if (seen.has(p)) throw new LocalizedError('errors.folderCycle');
            seen.add(p);
            p = w.folders.find(x => x.id === p)?.parentId || null;
        }
    }
    w.boards.forEach(b => {
        if (!b || typeof b.id !== 'string' || !Array.isArray(b.nodes) || !Array.isArray(b.edges) || !b.viewport) throw new LocalizedError('errors.invalidCanvas');
        const ids = unique(b.nodes);
        unique(b.edges);
        if (!Number.isFinite(b.viewport.x) || !Number.isFinite(b.viewport.y) || !Number.isFinite(b.viewport.zoom) || b.viewport.zoom <= 0) throw new LocalizedError('errors.invalidCanvasViewport');
        for (const node of b.nodes) {
            if (!node.position || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y) || !node.data || !['object', 'group'].includes(node.type || '')) throw new LocalizedError('errors.invalidCanvasObject');
            if (node.type === 'object' && !['note', 'text', 'shape', 'drawing', 'image'].includes(String(node.data.kind))) throw new LocalizedError('errors.unknownCanvasObject');
            if (node.data.kind === 'image' && !safeImage(node.data.src)) throw new LocalizedError('errors.unsafeCanvasImage');
            const seen = new Set([node.id]);
            let parent = node.parentId;
            while (parent) {
                if (!ids.has(parent) || seen.has(parent)) throw new LocalizedError('errors.invalidCanvasGroup');
                seen.add(parent);
                parent = b.nodes.find(n => n.id === parent)?.parentId;
            }
        }
        if (b.edges.some(edge => !ids.has(edge.source) || !ids.has(edge.target))) throw new LocalizedError('errors.invalidCanvasConnection');
    });
    w.attachments.forEach(a => {
        if (typeof a.data !== 'string' || !a.data.startsWith('data:')) throw new LocalizedError('errors.invalidAttachment');
    });
    if (w.syncState) {
        if (typeof w.syncState.server !== 'string' || !/^[a-f0-9]{64}$/.test(w.syncState.server) || typeof w.syncState.digest !== 'string' || typeof w.syncState.etag !== 'string' || !w.syncState.base || w.syncState.base.syncState) throw new LocalizedError('errors.invalidBackupFormat');
        validateWorkspace(w.syncState.base);
    }
    return {
        ...w,
        sidebarWidth: Math.min(420, Math.max(200, Number(w.sidebarWidth) || 260)),
        theme: w.theme === 'light' ? 'light' : 'dark'
    };
}
