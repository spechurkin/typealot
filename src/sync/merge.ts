import type {Attachment, Board, Folder, Note, Workspace} from '../storage/model';
import {canonical, mergeNotes} from '../../shared/collaboration.mjs';
import {diffBoard} from '../../shared/board-patches.mjs';

export type FileConflict = { id: string; title: string } & (
    { kind?: 'notes'; local?: Note; remote?: Note } |
    { kind: 'boards'; local?: Board; remote?: Board } |
    { kind: 'attachments'; local?: Attachment; remote?: Attachment } |
    { kind: 'folders'; local?: Folder; remote?: Folder }
    );
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const contentOf = (note?: Note) => note ? {title: note.title, content: note.content} : undefined;
const noteVersion = (note?: Note) => note ? {
    ...contentOf(note),
    folderId: note.folderId,
    order: note.order
} : undefined;
const persistentItem = (item?: object) => item && Object.fromEntries(Object.entries(item).filter(([key]) => !['selected', 'dragging', 'measured', 'resizing', 'draggable', 'deletable'].includes(key)));

function records<T extends {
    id: string
}>(base: T[], local: T[], remote: T[], merge: (b: T | undefined, l: T, r: T) => T, conflict?: (l?: T, r?: T) => void, equivalent: (a: T | undefined, b: T | undefined) => boolean = same): T[] {
    const b = new Map(base.map(v => [v.id, v])), l = new Map(local.map(v => [v.id, v])),
        r = new Map(remote.map(v => [v.id, v]));
    const result: T[] = [];
    for (const id of new Set([...r.keys(), ...l.keys(), ...b.keys()])) {
        const before = b.get(id), left = l.get(id), right = r.get(id);
        const unchanged = !left || !right ? equivalent : same;
        if (same(left, right)) {
            if (left) result.push(left);
            continue;
        }
        if (unchanged(left, before)) {
            if (right) result.push(right);
            continue;
        }
        if (unchanged(right, before)) {
            if (left) result.push(left);
            continue;
        }
        if (left && right) result.push(merge(before, left, right));
        else if (!before) {
            if (right || left) result.push((right || left)!);
        } else {
            conflict?.(left, right);
            result.push((right || left)!);
        }
    }
    return result;
}

function properties<T extends object>(base: T | undefined, local: T, remote: T, conflict?: () => void): T {
    const result = {...remote} as Record<string, unknown>;
    for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
        const b = (base as Record<string, unknown> | undefined)?.[key], l = (local as Record<string, unknown>)[key],
            r = (remote as Record<string, unknown>)[key];
        if (same(l, r) || same(l, b)) result[key] = r;
        else if (same(r, b)) result[key] = l;
        else if (l && r && typeof l === 'object' && typeof r === 'object' && !Array.isArray(l) && !Array.isArray(r)) {
            result[key] = properties(b && typeof b === 'object' && !Array.isArray(b) ? b : undefined, l, r, conflict);
        } else {
            conflict?.();
            result[key] = r;
        }
    }
    return result as T;
}

function boardMerge(base: Board | undefined, local: Board, remote: Board, conflict: () => void): Board {
    const nodes = records(base?.nodes || [], local.nodes, remote.nodes, (b, l, r) => ({
        ...properties(b, l, r, conflict),
        data: properties(b?.data, l.data, r.data, conflict),
        style: properties(b?.style, l.style || {}, r.style || {}, conflict)
    }), conflict, (a, b) => same(persistentItem(a), persistentItem(b)));
    const ids = new Set(nodes.map(n => n.id));
    return {
        ...properties(base && {title: base.title}, {title: local.title}, {title: remote.title}, conflict),
        id: remote.id,
        viewport: local.viewport,
        nodes: nodes.map(n => n.parentId && !ids.has(n.parentId) ? {...n, parentId: undefined} : n),
        edges: records(base?.edges || [], local.edges, remote.edges, (b, l, r) => properties(b, l, r, conflict), conflict, (a, b) => same(persistentItem(a), persistentItem(b))).filter(e => ids.has(e.source) && ids.has(e.target))
    };
}

export function mergeWorkspaces(base: Workspace | undefined, local: Workspace, remote: Workspace, protectLocal = false): {
    workspace: Workspace;
    conflicts: FileConflict[]
} {
    if (!base) return {
        conflicts: protectLocal ? [
            ...local.notes.flatMap(note => {
                const other = remote.notes.find(item => item.id === note.id);
                return same(noteVersion(note), noteVersion(other)) ? [] : [{
                    id: note.id,
                    title: note.title,
                    local: note,
                    remote: other
                }];
            }),
            ...local.boards.flatMap(board => {
                const other = remote.boards.find(item => item.id === board.id);
                return other && !diffBoard(board, other) ? [] : [{
                    kind: 'boards' as const,
                    id: board.id,
                    title: board.title,
                    local: board,
                    remote: other
                }];
            }),
            ...local.attachments.flatMap(file => {
                const other = remote.attachments.find(item => item.id === file.id);
                return same(file, other) ? [] : [{
                    kind: 'attachments' as const,
                    id: file.id,
                    title: file.name,
                    local: file,
                    remote: other
                }];
            }),
            ...local.folders.flatMap(folder => {
                const other = remote.folders.find(item => item.id === folder.id);
                return same(folder, other) ? [] : [{
                    kind: 'folders' as const,
                    id: folder.id,
                    title: folder.name,
                    local: folder,
                    remote: other
                }];
            })
        ] : [],
        workspace: {
            ...remote,
            theme: local.theme,
            sidebar: local.sidebar,
            sidebarWidth: local.sidebarWidth,
            markdown: local.markdown,
            profile: local.profile,
            boards: remote.boards.map(board => ({
                ...board,
                viewport: local.boards.find(candidate => candidate.id === board.id)?.viewport || board.viewport
            }))
        }
    };
    const conflicts: FileConflict[] = [];
    const report = (conflict: FileConflict) => {
        if (!conflicts.some(item => item.id === conflict.id && item.kind === conflict.kind)) conflicts.push(conflict);
    };
    const notes = records(base?.notes || [], local.notes, remote.notes, (before, left, right) => {
        const conflict = () => report({id: left.id, title: right.title || left.title, local: left, remote: right});
        const metadata = properties(before && {
            folderId: before.folderId,
            order: before.order
        }, {folderId: left.folderId, order: left.order}, {folderId: right.folderId, order: right.order}, conflict);
        const merged = mergeNotes(left, right);
        if (merged) return {
            ...merged,
            ...metadata
        };
        const localChanged = !same(contentOf(left), contentOf(before)),
            remoteChanged = !same(contentOf(right), contentOf(before));
        if (localChanged && remoteChanged && !same(contentOf(left), contentOf(right))) conflict();
        if (!localChanged) return {...right, ...metadata};
        if (!remoteChanged) return {...left, ...metadata};
        return {...right, ...metadata};
    }, (local, remote) => report({
        id: (local || remote)!.id,
        title: (remote || local)!.title,
        local,
        remote
    }), (a, b) => same(noteVersion(a), noteVersion(b)));
    const folderConflict = (local?: Folder, remote?: Folder) => report({
        kind: 'folders',
        id: (local || remote)!.id,
        title: (remote || local)!.name,
        local,
        remote
    });
    const folders = records(base?.folders || [], local.folders, remote.folders, (b, l, r) => properties(b, l, r, () => folderConflict(l, r)), folderConflict);
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
            syncState: local.syncState,
            notes: notes.map(n => ({...n, folderId: n.folderId && ids.has(n.folderId) ? n.folderId : null})),
            folders: safeFolders,
            boards: records(base?.boards || [], local.boards, remote.boards,
                (b, l, r) => boardMerge(b, l, r, () => report({
                    kind: 'boards',
                    id: l.id,
                    title: r.title || l.title,
                    local: l,
                    remote: r
                })),
                (local, remote) => report({
                    kind: 'boards',
                    id: (local || remote)!.id,
                    title: (remote || local)!.title,
                    local,
                    remote
                }),
                (a, b) => a && b ? !diffBoard(a, b) : same(a, b)),
            attachments: records(base?.attachments || [], local.attachments, remote.attachments,
                (b, l, r) => properties(b, l, r, () => report({
                    kind: 'attachments',
                    id: l.id,
                    title: r.name || l.name,
                    local: l,
                    remote: r
                })),
                (local, remote) => report({
                    kind: 'attachments',
                    id: (local || remote)!.id,
                    title: (remote || local)!.name,
                    local,
                    remote
                }))
        }
    };
}
