import {expect, it} from 'vitest';
import {initialWorkspace, validateWorkspace} from '../src/model';
import {folderNotes, moveNote} from '../src/note-drag';
import {mergeWorkspaces} from '../src/merge';

it('preserves manual placement when another replica changes content', () => {
    const base = initialWorkspace();
    base.notes.push({...base.notes[0], id: 'second'});
    const local = moveNote(base, 'second', 'inbox', 'welcome');
    const remote = structuredClone(base);
    remote.notes[1].title = 'Edited remotely';
    const result = validateWorkspace(mergeWorkspaces(base, local, remote).workspace);
    expect(folderNotes(result, 'inbox').map(n => n.id)).toEqual(['second', 'welcome']);
    expect(result.notes.find(n => n.id === 'second')?.title).toBe('Edited remotely');
    expect(moveNote(base, 'second', 'missing')).toBe(base);
    expect(moveNote(base, 'second', 'inbox', 'missing')).toBe(base);
    expect(moveNote(base, 'second', 'inbox', 'second')).toBe(base);
});
