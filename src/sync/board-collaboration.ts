import {useEffect, useMemo, useRef, useState} from 'react';
import {applyBoardPatch, diffBoard} from '../../shared/board-patches.mjs';
import {
    Awareness,
    bindAwareness,
    type ObjectLock,
    presenceBytes,
    receivePresence,
    useConnection,
    useIdentity,
    useRealtime,
    Y
} from './realtime';
import type {Board, Workspace} from '../storage/model';
import {checkpoint} from '../storage/storage';

type Session = { doc: Y.Doc; awareness: Awareness; users: number; timer?: ReturnType<typeof setTimeout> };
const sessions = new Map<string, Session>();

function boardSession(id: string): Session {
    if (sessions.has(id)) return sessions.get(id)!;
    const doc = new Y.Doc(), session = {doc, awareness: new Awareness(doc), users: 0};
    sessions.set(id, session);
    return session;
}

export function useBoardCollaboration(board: Board, workspace: Workspace, update: (patch: Partial<Board>) => void) {
    const channel = useRealtime(), status = useConnection(channel),
        session = useMemo(() => boardSession(board.id), [board.id]);
    const current = useRef(board);
    current.current = board;
    const currentWorkspace = useRef(workspace);
    currentWorkspace.current = workspace;
    const baseline = useRef(board), write = useRef(update);
    write.current = update;
    const joined = useRef(false), sendTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const [locks, setLocks] = useState<Record<string, ObjectLock>>({}), lockRef = useRef(locks);
    lockRef.current = locks;
    const pending = useRef(new Map<string, (granted: boolean) => void>());
    useIdentity(session.awareness, workspace.profile);
    const room = `board:${board.id}`;
    const send = () => {
        if (!channel || !joined.current) return;
        const patch = diffBoard(baseline.current, current.current);
        if (patch) {
            channel.send({type: 'board-patch', room, patch});
            baseline.current = current.current;
        }
    };
    const schedule = () => {
        if (sendTimer.current) return;
        sendTimer.current = setTimeout(() => {
            sendTimer.current = undefined;
            send();
        }, 30);
    };
    useEffect(() => {
        clearTimeout(session.timer);
        session.users++;
        return () => {
            session.users--;
            session.timer = setTimeout(() => {
                if (!session.users) {
                    session.awareness.destroy();
                    session.doc.destroy();
                    sessions.delete(board.id);
                }
            }, 100);
        };
    }, [session, board.id]);
    useEffect(() => {
        lockRef.current = {};
        setLocks({});
        if (!channel) return;
        const offPresence = bindAwareness(session.awareness, channel, room);
        const off = channel.join(room, {
            clientID: session.doc.clientID, presence: () => presenceBytes(session.awareness), connected: () => {
                joined.current = true;
                send();
            },
            message: message => {
                receivePresence(session.awareness, message);
                if (message.type === 'disconnected') {
                    joined.current = false;
                    lockRef.current = {};
                    setLocks({});
                }
                if (message.type === 'locks' && message.locks) {
                    lockRef.current = message.locks;
                    setLocks(message.locks);
                }
                if (message.type === 'lock-result' && message.objectId) {
                    pending.current.get(message.objectId)?.(!!message.granted);
                    pending.current.delete(message.objectId);
                }
                if ((message.type === 'board-state' || message.type === 'board-denied') && message.board) {
                    if (message.type === 'board-denied') void checkpoint(currentWorkspace.current).catch(error => window.dispatchEvent(new CustomEvent('typealot:error', {detail: String(error)})));
                    const before = baseline.current, local = current.current;
                    const patch = diffBoard(before, local);
                    const remote = message.type === 'board-denied' || !patch ? message.board : applyBoardPatch(message.board, patch);
                    const selected = new Map(local.nodes.map(node => [node.id, node.selected]));
                    const next = {
                        ...remote,
                        viewport: local.viewport,
                        nodes: remote.nodes.map(node => ({...node, selected: selected.get(node.id) || false}))
                    };
                    baseline.current = message.board;
                    current.current = next;
                    write.current({nodes: next.nodes, edges: next.edges, title: next.title});
                }
            }
        });
        return () => {
            joined.current = false;
            clearTimeout(sendTimer.current);
            sendTimer.current = undefined;
            offPresence();
            off();
            receivePresence(session.awareness, {type: 'disconnected'});
            for (const resolve of pending.current.values()) resolve(false);
            pending.current.clear();
        };
    }, [session, channel, room]);
    useEffect(() => {
        schedule();
    }, [board, channel, status]);
    useEffect(() => {
        session.awareness.setLocalStateField('selected', board.nodes.filter(node => node.selected).map(node => node.id));
    }, [session, board.nodes]);
    const foreignLock = (id: string) => {
        const lock = locks[id];
        return channel && status === 'connected' && lock && lock.owner !== channel.id ? lock : undefined;
    };
    const claim = (id: string): Promise<boolean> => {
        if (!channel || status !== 'connected' || board.nodes.find(node => node.id === id)?.data.kind === 'note') return Promise.resolve(true);
        if (foreignLock(id)) return Promise.resolve(false);
        if (locks[id]?.owner === channel.id) return Promise.resolve(true);
        return new Promise(resolve => {
            pending.current.get(id)?.(false);
            pending.current.set(id, resolve);
            channel.send({type: 'lock', room, objectId: id});
            setTimeout(() => {
                if (pending.current.get(id) === resolve) {
                    pending.current.delete(id);
                    resolve(false);
                }
            }, 3000);
        });
    };
    const release = (id: string) => {
        if (channel && lockRef.current[id]?.owner === channel.id) channel.send({type: 'unlock', room, objectId: id});
    };
    useEffect(() => {
        const hidden = () => {
            if (document.visibilityState === 'hidden' && channel) for (const [id, lock] of Object.entries(lockRef.current)) if (lock.owner === channel.id) channel.send({
                type: 'unlock',
                room,
                objectId: id
            });
        };
        document.addEventListener('visibilitychange', hidden);
        return () => document.removeEventListener('visibilitychange', hidden);
    }, [channel, room]);
    const editable = (id: string) => !foreignLock(id);
    return {
        channel,
        session,
        locks,
        foreignLock,
        claim,
        release,
        editable,
        pointer: (point: { x: number; y: number } | null) => session.awareness.setLocalStateField('pointer', point)
    };
}

export type BoardCollaboration = ReturnType<typeof useBoardCollaboration>;
