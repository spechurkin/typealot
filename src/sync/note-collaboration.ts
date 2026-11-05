import {useEffect, useMemo, useRef} from 'react';
import {type Extensions, getSchema} from '@tiptap/core';
import {
    assertDocument,
    createNoteDocument,
    decode,
    encode,
    generationOf,
    noteSnapshot,
    replaceText
} from '../../shared/collaboration.mjs';
import {Awareness, bindAwareness, presenceBytes, receivePresence, useIdentity, useRealtime, Y} from './realtime';
import type {Note, Workspace} from '../storage/model';

type Session = {
    doc: Y.Doc;
    generation: string;
    awareness: Awareness;
    users: number;
    timer?: ReturnType<typeof setTimeout>
};
const sessions = new Map<string, Session>();

function getSession(note: Note, extensions: Extensions) {
    const generation = note.collaboration?.generation || generationOf(note), key = `${note.id}:${generation}`;
    if (sessions.has(key)) return {key, session: sessions.get(key)!};
    const {doc} = createNoteDocument(note, getSchema(extensions));
    const session: Session = {doc, generation, awareness: new Awareness(doc), users: 0};
    sessions.set(key, session);
    return {key, session};
}

export function useNoteCollaboration(note: Note, extensions: Extensions, profile: Workspace['profile'], update: (patch: Partial<Note>) => void) {
    const generation = note.collaboration?.generation || generationOf(note);
    const {key, session} = useMemo(() => getSession(note, extensions), [note.id, generation]);
    const channel = useRealtime(), latest = useRef(note), write = useRef(update);
    latest.current = note;
    write.current = update;
    useIdentity(session.awareness, profile);
    useEffect(() => {
        clearTimeout(session.timer);
        session.users++;
        const publish = () => {
            const snapshot = noteSnapshot(latest.current, session.doc, session.generation);
            if (snapshot.collaboration!.state === latest.current.collaboration?.state && snapshot.title === latest.current.title) return;
            write.current({
                title: snapshot.title,
                content: snapshot.content,
                collaboration: snapshot.collaboration,
                updatedAt: Date.now()
            });
        };
        session.doc.on('update', publish);
        publish();
        return () => {
            session.doc.off('update', publish);
            session.users--;
            session.timer = setTimeout(() => {
                if (!session.users) {
                    session.awareness.destroy();
                    session.doc.destroy();
                    sessions.delete(key);
                }
            }, 100);
        };
    }, [session, key]);
    useEffect(() => {
        if (note.collaboration?.generation === session.generation) {
            try {
                Y.applyUpdate(session.doc, decode(note.collaboration.state), 'remote');
            } catch {
            }
        }
    }, [session, note.collaboration?.state]);
    useEffect(() => {
        if (!channel) return;
        const room = `note:${note.id}`;
        const offPresence = bindAwareness(session.awareness, channel, room);
        const off = channel.join(room, {
            clientID: session.doc.clientID, presence: () => presenceBytes(session.awareness),
            connected: () => channel.send({
                type: 'note-update',
                room,
                generation: session.generation,
                update: encode(Y.encodeStateAsUpdate(session.doc))
            }),
            message: message => {
                receivePresence(session.awareness, message);
                const state = message.type === 'note-state' ? message.note?.collaboration : message.type === 'note-update' ? {
                    generation: message.generation,
                    state: message.update
                } : undefined;
                if (state?.generation === session.generation && state.state) {
                    const candidate = new Y.Doc();
                    try {
                        Y.applyUpdate(candidate, Y.encodeStateAsUpdate(session.doc));
                        Y.applyUpdate(candidate, decode(state.state));
                        assertDocument(noteSnapshot(latest.current, candidate, session.generation).content);
                        Y.applyUpdate(session.doc, decode(state.state), 'remote');
                    } catch {
                    } finally {
                        candidate.destroy();
                    }
                }
            }
        });
        const send = (bytes: Uint8Array, origin: unknown) => {
            if (origin !== 'remote') channel.send({
                type: 'note-update',
                room,
                generation: session.generation,
                update: encode(bytes)
            });
        };
        session.doc.on('update', send);
        return () => {
            session.doc.off('update', send);
            offPresence();
            off();
            receivePresence(session.awareness, {type: 'disconnected'});
        };
    }, [session, channel, note.id]);
    return {session, channel, setTitle: (value: string) => replaceText(session.doc.getText('title'), value, 'title')};
}
