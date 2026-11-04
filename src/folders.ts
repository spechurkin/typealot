import type {Workspace} from './model';

export function folderDescendants(workspace: Workspace, id: string): Set<string> {
    const ids = new Set([id]);
    let added = true;
    while (added) {
        added = false;
        for (const folder of workspace.folders) {
            if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
                ids.add(folder.id);
                added = true;
            }
        }
    }
    return ids;
}

export function folderChildren(workspace: Workspace, parentId: string | null) {
    return workspace.folders.filter(f => f.parentId === parentId)
        .sort((a, b) => (a.order ?? workspace.folders.indexOf(a)) - (b.order ?? workspace.folders.indexOf(b)));
}

export function moveFolder(workspace: Workspace, id: string, parentId: string | null,
                           targetId?: string, after = false): Workspace {
    if (!workspace.folders.some(f => f.id === id) || id === targetId) return workspace;
    if (parentId && (!workspace.folders.some(f => f.id === parentId) || folderDescendants(workspace, id).has(parentId))) return workspace;
    const siblings = folderChildren(workspace, parentId).filter(f => f.id !== id);
    const index = targetId ? siblings.findIndex(f => f.id === targetId) : siblings.length;
    if (index < 0) return workspace;
    siblings.splice(index + (targetId && after ? 1 : 0), 0, workspace.folders.find(f => f.id === id)!);
    const ranks = new Map(siblings.map((f, i) => [f.id, i]));
    return {
        ...workspace, folders: workspace.folders.map(f => ranks.has(f.id)
            ? {...f, parentId, order: ranks.get(f.id)!} : f)
    };
}

export function removeFolder(workspace: Workspace, id: string): Workspace {
    const folder = workspace.folders.find(f => f.id === id);
    if (!folder) return workspace;
    return {
        ...workspace,
        folders: workspace.folders.filter(f => f.id !== id).map(f => f.parentId === id ? {
            ...f,
            parentId: folder.parentId
        } : f),
        notes: workspace.notes.map(n => n.folderId === id ? {...n, folderId: folder.parentId} : n)
    };
}
