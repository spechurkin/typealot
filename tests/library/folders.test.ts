import {describe, expect, it} from 'vitest';
import {initialWorkspace, validateWorkspace} from '../../src/storage/model';
import {folderChildren, moveFolder, removeFolder} from '../../src/library/folders';

describe('folder operations', () => {
    it('prevents moving a folder into itself or its descendants', () => {
        const w = initialWorkspace();
        w.folders.push({id: 'child', name: 'Child', parentId: 'inbox'}, {id: 'leaf', name: 'Leaf', parentId: 'child'});
        expect(moveFolder(w, 'inbox', 'leaf')).toBe(w);
        expect(moveFolder(w, 'inbox', 'inbox')).toBe(w);
        expect(moveFolder(w, 'inbox', 'missing')).toBe(w);
        const moved = moveFolder(w, 'child', null);
        expect(validateWorkspace(moved).folders.find(f => f.id === 'child')?.parentId).toBeNull();
        expect(moved.folders.find(f => f.id === 'leaf')?.parentId).toBe('child');
    });
    it('deletes only the folder and reparents documents and child folders', () => {
        const w = initialWorkspace();
        w.folders.push({id: 'child', name: 'Child', parentId: 'inbox'}, {id: 'leaf', name: 'Leaf', parentId: 'child'});
        w.notes.push({...w.notes[0], id: 'nested', folderId: 'child'});
        const result = validateWorkspace(removeFolder(w, 'inbox'));
        expect(result.notes).toHaveLength(2);
        expect(result.notes[0]).toEqual({...w.notes[0], folderId: null});
        expect(result.folders.find(f => f.id === 'child')?.parentId).toBeNull();
        expect(result.folders.find(f => f.id === 'leaf')?.parentId).toBe('child');
        expect(result.notes[1].folderId).toBe('child');
    });
});

it('stores sibling order and rejects an invalid reorder destination', () => {
    const w = initialWorkspace();
    w.folders.push({id: 'archive', name: 'Archive', parentId: null});
    const sorted = validateWorkspace(moveFolder(w, 'archive', null, 'inbox'));
    expect(folderChildren(sorted, null).map(f => f.id)).toEqual(['archive', 'inbox']);
    expect(moveFolder(w, 'archive', null, 'missing')).toBe(w);
    expect(moveFolder(w, 'archive', null, 'archive')).toBe(w);
    expect(() => validateWorkspace({...w, folders: [{...w.folders[0], order: NaN}]})).toThrow();
});
