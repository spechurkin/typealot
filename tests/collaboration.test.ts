import {describe, expect, it} from 'vitest';
import {getSchema} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import * as Y from 'yjs';
import {createNoteDocument, mergeNotes, noteSnapshot, replaceText} from '../shared/collaboration.mjs';
import {applyBoardPatch, diffBoard} from '../shared/board-patches.mjs';
import {initialWorkspace} from '../src/model';
import {mergeWorkspaces} from '../src/merge';
import {cursorName} from '../src/realtime';

const schema = getSchema([StarterKit]);
const baseNote = () => ({
    ...initialWorkspace().notes[0],
    title: 'Plan',
    content: {type: 'doc', content: [{type: 'paragraph', content: [{type: 'text', text: 'Start finish'}]}]}
});
describe('CRDT document merging', () => {
    it('seeds identical legacy documents once and merges concurrent text and title edits in either order', () => {
        const note = baseNote(), left = createNoteDocument(note, schema), right = createNoteDocument(note, schema);
        expect(Y.encodeStateAsUpdate(left.doc)).toEqual(Y.encodeStateAsUpdate(right.doc));
        const a = (left.doc.getXmlFragment('content').get(0) as Y.XmlElement).get(0) as Y.XmlText;
        const b = (right.doc.getXmlFragment('content').get(0) as Y.XmlElement).get(0) as Y.XmlText;
        a.insert(0, 'Alice ');
        b.insert(b.length, ' Bob');
        replaceText(left.doc.getText('title'), 'Plan A');
        replaceText(right.doc.getText('title'), 'Plan B');
        const l = noteSnapshot(note, left.doc, left.generation), r = noteSnapshot(note, right.doc, right.generation);
        const first = mergeNotes(l, r)!, second = mergeNotes(r, l)!;
        expect(first.content).toEqual(second.content);
        expect(first.title).toEqual(second.title);
        expect(JSON.stringify(first.content)).toContain('Alice Start finish Bob');
        expect(first.title).toContain('A');
        expect(first.title).toContain('B');
        left.doc.destroy();
        right.doc.destroy();
    });
    it('preserves the persisted CRDT history through JSON export and offline rejoining', () => {
        const note = baseNote(), seed = createNoteDocument(note, schema),
            saved = noteSnapshot(note, seed.doc, seed.generation);
        const left = createNoteDocument(JSON.parse(JSON.stringify(saved)), schema),
            right = createNoteDocument(saved, schema);
        replaceText(left.doc.getText('title'), 'Local Plan');
        replaceText(right.doc.getText('title'), 'Plan Remote');
        const merged = mergeNotes(noteSnapshot(saved, left.doc, left.generation), noteSnapshot(saved, right.doc, right.generation))!;
        expect(merged.title).toBe('Local Plan Remote');
        const reopened = createNoteDocument(merged, schema);
        expect(reopened.doc.getText('title').toString()).toBe(merged.title);
        [seed, left, right, reopened].forEach(session => session.doc.destroy());
    });
    it('keeps emoji intact when a shared surrogate prefix changes', () => {
        const doc = new Y.Doc(), text = doc.getText('title');
        text.insert(0, 'A 😀 Z');
        replaceText(text, 'A 😃 Z');
        expect(text.toString()).toBe('A 😃 Z');
        doc.destroy();
    });
});
describe('file-scoped synchronization', () => {
    it('merges different edited files without a warning and keeps device preferences local', () => {
        const base = initialWorkspace();
        base.notes.push({...base.notes[0], id: 'second'});
        const local = structuredClone(base), remote = structuredClone(base);
        local.notes[0].title = 'Local first';
        remote.notes[1].title = 'Remote second';
        remote.profile.handle = 'remote-user';
        local.profile.handle = 'my-user';
        const result = mergeWorkspaces(base, local, remote);
        expect(result.conflicts).toEqual([]);
        expect(result.workspace.notes.map(n => n.title)).toEqual(['Local first', 'Remote second']);
        expect(result.workspace.profile.handle).toBe('my-user');
    });
    it('defaults to server data on first contact and limits incompatible conflicts to the affected file', () => {
        const base = initialWorkspace(), local = structuredClone(base), remote = structuredClone(base);
        local.notes[0].title = 'local';
        remote.notes[0].title = 'server';
        expect(mergeWorkspaces(undefined, local, remote).workspace.notes[0].title).toBe('server');
        expect(mergeWorkspaces(undefined, local, remote).conflicts).toHaveLength(0);
        expect(mergeWorkspaces(base, local, remote).conflicts.map(file => file.id)).toEqual(['welcome']);
        remote.notes = [];
        const deleted = mergeWorkspaces(base, local, remote);
        expect(deleted.conflicts).toHaveLength(1);
        expect(deleted.conflicts[0].local).toMatchObject({title: 'local'});
        expect(deleted.conflicts[0].remote).toBeUndefined();
        expect(deleted.workspace.notes[0].title).toBe('local');
    });
    it('applies independent canvas property edits without replacing the other user changes', () => {
        const base = initialWorkspace().boards[0], left = structuredClone(base), right = structuredClone(base);
        left.nodes[0].position.x = 600;
        right.nodes[0].data.text = 'Other edit';
        const patch = diffBoard(base, left)!;
        const merged = applyBoardPatch(right, patch);
        expect(merged.nodes[0].position.x).toBe(600);
        expect(merged.nodes[0].data.text).toBe('Other edit');
        const selected = structuredClone(base);
        selected.nodes[0].selected = true;
        expect(diffBoard(base, selected)).toBeNull();
        expect(() => applyBoardPatch(base, {
            nodes: {
                remove: [],
                upsert: [{id: 'card', changes: [{path: ['__proto__', 'polluted'], value: true}]}]
            }, edges: {remove: [], upsert: []}
        })).toThrow();
    });
    it('merges independent offline canvas fields and stops on overlapping changes', () => {
        const base = initialWorkspace(), local = structuredClone(base), remote = structuredClone(base);
        local.boards[0].nodes[0].position.x = 200;
        remote.boards[0].nodes[0].position.y = 400;
        const independent = mergeWorkspaces(base, local, remote);
        expect(independent.conflicts).toEqual([]);
        expect(independent.workspace.boards[0].nodes[0].position).toEqual({x: 200, y: 400});
        remote.boards[0].nodes[0].position.x = 500;
        const conflicting = mergeWorkspaces(base, local, remote);
        expect(conflicting.conflicts).toHaveLength(1);
        expect(conflicting.conflicts[0]).toMatchObject({
            kind: 'boards',
            local: local.boards[0],
            remote: remote.boards[0]
        });
    });
    it('detects edit/delete conflicts in both directions for all file types', () => {
        const base = initialWorkspace();
        base.attachments.push({id: 'file', name: 'old.txt', mime: 'text/plain', data: 'data:text/plain;base64,b2xk'});
        const edited = structuredClone(base), deleted = structuredClone(base);
        edited.notes[0].title = 'Edited note';
        edited.folders[0].name = 'Edited folder';
        edited.boards[0].title = 'Edited board';
        edited.attachments[0].data = 'data:text/plain;base64,bmV3';
        deleted.notes = [];
        deleted.folders = [];
        deleted.boards = [];
        deleted.attachments = [];
        for (const [local, remote] of [[edited, deleted], [deleted, edited]]) {
            const result = mergeWorkspaces(base, local, remote);
            expect(result.conflicts.map(file => file.kind || 'notes').sort()).toEqual(['attachments', 'boards', 'folders', 'notes']);
        }
    });
    it('applies server deletions to unchanged files despite local canvas state and note timestamps', () => {
        const base = initialWorkspace(), local = structuredClone(base), remote = structuredClone(base);
        local.boards[0].nodes[0].selected = true;
        local.boards[0].nodes[0].measured = {width: 300, height: 200};
        local.boards[0].viewport = {x: 200, y: 400, zoom: 2};
        local.notes[0].updatedAt++;
        remote.notes = [];
        remote.boards = [];
        const result = mergeWorkspaces(base, local, remote);
        expect(result.conflicts).toEqual([]);
        expect(result.workspace.notes).toEqual([]);
        expect(result.workspace.boards).toEqual([]);
    });
    it('labels cursors with an unprefixed handle and falls back to the name', () => {
        expect(cursorName({name: 'Name', handle: ' @Alias ', show: true})).toBe('Alias');
        expect(cursorName({name: 'Name', handle: '', show: true})).toBe('Name');
    });
});
