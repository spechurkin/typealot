import {createContext, useContext, useEffect, useSyncExternalStore} from 'react';
import * as Y from 'yjs';
import {applyAwarenessUpdate, Awareness, encodeAwarenessUpdate, removeAwarenessStates} from 'y-protocols/awareness';
import {decode, encode} from '../../shared/collaboration.mjs';
import type {Board, Note, Workspace} from '../storage/model';
import {randomId} from '../storage/crypto';
import {t} from '../locales/i18n';

export type ObjectLock = { owner: string; name: string; color?: string };
export type LiveMessage = {
    type: string;
    room?: string;
    note?: Note;
    board?: Board;
    generation?: string;
    update?: string;
    etag?: string;
    locks?: Record<string, ObjectLock>;
    objectId?: string;
    granted?: boolean;
    color?: string;
    token?: string
};
type Room = {
    clientID: number;
    message: (message: LiveMessage) => void;
    connected: () => void;
    presence: () => string
};

export class RealtimeChannel {
    readonly id = randomId();
    color?: string;
    token?: string;
    private socket: WebSocket | null = null;
    private rooms = new Map<string, Room>();
    private listeners = new Set<() => void>();
    private retry: ReturnType<typeof setTimeout> | undefined;
    private ping: ReturnType<typeof setInterval> | undefined;
    private stopped = false;
    private joined = new Set<string>();
    private attempts = 0;
    private state: 'connecting' | 'connected' | 'offline' = 'connecting';

    constructor(readonly url: string, private changed: () => void) {
        this.connect();
    }

    readonly subscribe = (fn: () => void) => {
        this.listeners.add(fn);
        return () => {
            this.listeners.delete(fn);
        };
    };
    readonly status = () => this.state;

    send(message: object) {
        if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
    }

    join(name: string, room: Room) {
        this.joined.delete(name);
        this.rooms.set(name, room);
        if (this.color) room.message({type: 'identity', color: this.color});
        if (this.state === 'connected') this.send({type: 'join', room: name, clientID: room.clientID});
        return () => {
            this.send({type: 'leave', room: name});
            if (this.rooms.get(name) === room) {
                this.rooms.delete(name);
                this.joined.delete(name);
            }
        };
    }

    destroy() {
        this.stopped = true;
        clearTimeout(this.retry);
        clearInterval(this.ping);
        this.socket?.close();
        this.rooms.clear();
        this.listeners.clear();
    }

    private setState(state: typeof this.state) {
        this.state = state;
        this.listeners.forEach(fn => fn());
    }

    private connect() {
        if (this.stopped) return;
        this.setState('connecting');
        const socket = new WebSocket(this.url);
        this.socket = socket;
        socket.onopen = () => {
            this.attempts = 0;
            this.joined.clear();
            this.setState('connected');
            this.send({type: 'hello', id: this.id});
            for (const [name, room] of this.rooms) {
                this.send({type: 'join', room: name, clientID: room.clientID});
            }
            this.changed();
            this.ping = setInterval(() => this.send({type: 'ping'}), 15000);
        };
        socket.onmessage = event => {
            let message: LiveMessage;
            try {
                message = JSON.parse(event.data);
            } catch {
                return;
            }
            if (!message || typeof message !== 'object' || typeof message.type !== 'string') return;
            if (message.type === 'identity' && typeof message.color === 'string' && /^#[\da-f]{6}$/i.test(message.color)) {
                this.color = message.color;
                this.token = message.token;
                for (const room of this.rooms.values()) room.message(message);
                return;
            }
            if (message.type === 'workspace') {
                if (!message.room || !this.rooms.has(message.room)) this.changed();
                return;
            }
            const room = message.room && this.rooms.get(message.room);
            if (!room) return;
            room.message(message);
            if ((message.type === 'note-state' || message.type === 'board-state') && !this.joined.has(message.room!)) {
                this.joined.add(message.room!);
                room.connected();
                this.send({type: 'presence', room: message.room, update: room.presence()});
            }
        };
        socket.onerror = () => socket.close();
        socket.onclose = () => {
            clearInterval(this.ping);
            if (this.stopped) return;
            this.setState('offline');
            for (const room of this.rooms.values()) room.message({type: 'disconnected'});
            this.retry = setTimeout(() => this.connect(), Math.min(10000, 500 * 2 ** Math.min(5, this.attempts++)));
        };
    }
}

export const RealtimeContext = createContext<RealtimeChannel | null>(null);
export const useRealtime = () => useContext(RealtimeContext);
const disconnected = () => 'offline' as const;
const emptySubscribe = () => () => {
};

export function useConnection(channel: RealtimeChannel | null) {
    return useSyncExternalStore(channel?.subscribe || emptySubscribe, channel?.status || disconnected, disconnected);
}

export function cursorName(profile: Workspace['profile']): string {
    return profile.handle.trim().replace(/^@+/, '').trim() || profile.name.trim() || t('collaboration.participantFallback');
}

export const cursorColors = ['#557db5', '#b16c4d', '#8d68ad', '#398a79', '#a17831', '#a75b83'];

export function identity(profile: Workspace['profile'], clientID: number) {
    return {name: cursorName(profile), color: cursorColors[clientID % cursorColors.length]};
}

export const presenceBytes = (awareness: Awareness) => encode(encodeAwarenessUpdate(awareness, [awareness.clientID]));

export function bindAwareness(awareness: Awareness, channel: RealtimeChannel, room: string) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const send = (_: unknown, origin: unknown) => {
        if (origin === 'remote') return;
        clearTimeout(timer);
        timer = setTimeout(() => channel.send({type: 'presence', room, update: presenceBytes(awareness)}), 35);
    };
    awareness.on('update', send);
    return () => {
        clearTimeout(timer);
        awareness.off('update', send);
    };
}

export function receivePresence(awareness: Awareness, message: LiveMessage) {
    if (message.type === 'identity' && message.color) awareness.setLocalStateField('user', {
        ...awareness.getLocalState()?.user,
        color: message.color
    });
    if (message.type === 'presence' && message.update) {
        try {
            applyAwarenessUpdate(awareness, decode(message.update), 'remote');
        } catch {
        }
    }
    if (message.type === 'disconnected') removeAwarenessStates(awareness, [...awareness.getStates().keys()].filter(id => id !== awareness.clientID), 'remote');
}

export function useIdentity(awareness: Awareness, profile: Workspace['profile']) {
    useEffect(() => {
        const current = awareness.getLocalState()?.user;
        awareness.setLocalStateField('user', {...identity(profile, awareness.clientID), ...(current?.color ? {color: current.color} : {})});
    }, [awareness, profile.name, profile.handle]);
}

export {Y, Awareness};
