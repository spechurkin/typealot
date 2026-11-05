import type {Workspace} from '../storage/model';

export const FOLDER_DRAG_TYPE = 'application/x-typealot-folder';
let activeFolderId: string | null = null;
export const isFolderDrag = (data: DataTransfer | null) => !!data?.types.includes(FOLDER_DRAG_TYPE);

export function startFolderDrag(data: DataTransfer, id: string) {
    activeFolderId = id;
    data.setData(FOLDER_DRAG_TYPE, id);
    data.effectAllowed = 'move';
}

export function endFolderDrag() {
    activeFolderId = null;
}

export const draggedFolder = (data: DataTransfer | null, workspace: Workspace) =>
    workspace.folders.find(f => f.id === (data?.getData(FOLDER_DRAG_TYPE) || (isFolderDrag(data) ? activeFolderId : null)));
