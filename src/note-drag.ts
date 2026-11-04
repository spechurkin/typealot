import type {Note, Workspace} from './model';

let activeNoteId: string | null = null;

export function startNoteDrag(data: DataTransfer, id: string) {
    activeNoteId = id;
    data.setData(NOTE_DRAG_TYPE, id);
    data.effectAllowed = 'copyMove';
}

export function endNoteDrag() {
    activeNoteId = null;
}

export const NOTE_DRAG_TYPE = 'application/x-typealot-note';
export const isNoteDrag = (data: DataTransfer | null) => !!data?.types.includes(NOTE_DRAG_TYPE);
export const draggedNote = (data: DataTransfer | null, workspace: Workspace) =>
    workspace.notes.find(note => note.id === (data?.getData(NOTE_DRAG_TYPE) || (isNoteDrag(data) ? activeNoteId : null)));

export function folderNotes(workspace: Workspace, folderId: string | null): Note[] {
    return workspace.notes.filter(n => n.folderId === folderId)
        .sort((a, b) => (a.order ?? workspace.notes.indexOf(a)) - (b.order ?? workspace.notes.indexOf(b)));
}

export function moveNote(workspace: Workspace, id: string, folderId: string | null,
                         targetId?: string, after = false): Workspace {
    const note = workspace.notes.find(n => n.id === id);
    if (!note || id === targetId || (folderId && !workspace.folders.some(f => f.id === folderId))) return workspace;
    const siblings = folderNotes(workspace, folderId).filter(n => n.id !== id);
    const target = targetId ? siblings.findIndex(n => n.id === targetId) : siblings.length;
    if (target < 0) return workspace;
    siblings.splice(target + (targetId && after ? 1 : 0), 0, note);
    const ranks = new Map(siblings.map((n, index) => [n.id, index]));
    return {
        ...workspace, notes: workspace.notes.map(n => ranks.has(n.id)
            ? {...n, folderId, order: ranks.get(n.id)!} : n)
    };
}
