import type {Board, Note, Workspace} from './model';
import {canonical, mergeNotes} from '../shared/collaboration.mjs';

export type FileConflict = { id: string; title: string; local?: Note; remote?: Note };
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const contentOf = (note?: Note) => note ? {title: note.title, content: note.content} : undefined;

function records<T extends {
    id: string
}>(base: T[], local: T[], remote: T[], merge: (b: T | undefined, l: T, r: T) => T): T[] {
    const b = new Map(base.map(v => [v.id, v])), l = new Map(local.map(v => [v.id, v])),
        r = new Map(remote.map(v => [v.id, v]));
    const result: T[] = [];
    for (const id of new Set([...r.keys(), ...l.keys(), ...b.keys()])) {
        const before = b.get(id), left = l.get(id), right = r.get(id);
        if (same(left, right)) {
            if (left) result.push(left);
            continue;
        }
        if (same(left, before)) {
            if (right) result.push(right);
            continue;
        }
        if (same(right, before)) {
            if (left) result.push(left);
            continue;
        }
        if (left && right) result.push(merge(before, left, right));
        else if (!before) {
            if (right || left) result.push((right || left)!);
        }
        // A deletion wins over a concurrent edit; the editing replica keeps a checkpoint.
    }
    return result;
}

function properties<T extends object>(base: T | undefined, local: T, remote: T): T {
    const result = {...remote} as Record<string, unknown>;
    for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
        const b = (base as Record<string, unknown> | undefined)?.[key], l = (local as Record<string, unknown>)[key],
            r = (remote as Record<string, unknown>)[key];
        result[key] = same(r, b) ? l : r;
    }
    return result as T;
}

function boardMerge(base: Board | undefined, local: Board, remote: Board): Board {
    const nodes = records(base?.nodes || [], local.nodes, remote.nodes, (b, l, r) => ({
        ...properties(b, l, r),
        data: properties(b?.data, l.data, r.data),
        style: properties(b?.style, l.style || {}, r.style || {})
    }));
    const ids = new Set(nodes.map(n => n.id));
    return {
        ...properties(base, local, remote),
        viewport: local.viewport,
        nodes: nodes.map(n => n.parentId && !ids.has(n.parentId) ? {...n, parentId: undefined} : n),
        edges: records(base?.edges || [], local.edges, remote.edges, properties).filter(e => ids.has(e.source) && ids.has(e.target))
    };
}

export function mergeWorkspaces(base: Workspace | undefined, local: Workspace, remote: Workspace): {
    workspace: Workspace;
    conflicts: FileConflict[]
} {
    const conflicts: FileConflict[] = [];
    const notes = records(base?.notes || [], local.notes, remote.notes, (before, left, right) => {
        const metadata = {
            folderId: same(right.folderId, before?.folderId) ? left.folderId : right.folderId,
            order: same(right.order, before?.order) ? left.order : right.order
        };
        const merged = mergeNotes(left, right);
        if (merged) return {
            ...merged,
            ...metadata
        };
        const localChanged = !same(contentOf(left), contentOf(before)),
            remoteChanged = !same(contentOf(right), contentOf(before));
        if (before && localChanged && remoteChanged && !same(contentOf(left), contentOf(right))) conflicts.push({
            id: left.id,
            title: right.title || left.title,
            local: left,
            remote: right
        });
        if (!localChanged) return {...right, ...metadata};
        if (!remoteChanged) return {...left, ...metadata};
        return {...right, ...metadata};
    });
    for (const before of base?.notes || []) {
        const left = local.notes.find(note => note.id === before.id),
            right = remote.notes.find(note => note.id === before.id);
        if (!left && right && !same(contentOf(before), contentOf(right))) {
            conflicts.push({id: before.id, title: right.title, remote: right});
            if (!notes.some(note => note.id === right.id)) notes.push(right);
        }
        if (left && !right && !same(contentOf(before), contentOf(left))) conflicts.push({
            id: before.id,
            title: left.title,
            local: left
        });
    }
    const folders = records(base?.folders || [], local.folders, remote.folders, properties);
    const ids = new Set(folders.map(f => f.id));
    const safeFolders = folders.map(f => ({...f, parentId: f.parentId && ids.has(f.parentId) ? f.parentId : null}));
    for (const folder of safeFolders) {
        const seen = new Set([folder.id]);
        let parent = folder.parentId;
        while (parent) {
            if (seen.has(parent)) {
                folder.parentId = null;
                break;
            }
            seen.add(parent);
            parent = safeFolders.find(f => f.id === parent)?.parentId || null;
        }
    }
    return {
        conflicts, workspace: {
            ...remote,
            theme: local.theme,
            sidebar: local.sidebar,
            sidebarWidth: local.sidebarWidth,
            markdown: local.markdown,
            profile: local.profile,
            notes: notes.map(n => ({...n, folderId: n.folderId && ids.has(n.folderId) ? n.folderId : null})),
            folders: safeFolders,
            boards: records(base?.boards || [], local.boards, remote.boards, boardMerge),
            attachments: records(base?.attachments || [], local.attachments, remote.attachments, properties)
        }
    };
}
