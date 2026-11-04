import {WebSocket, WebSocketServer} from 'ws';
import * as Y from 'yjs';
import {applyAwarenessUpdate, Awareness, encodeAwarenessUpdate, removeAwarenessStates} from 'y-protocols/awareness';
import {assertDocument, canonical, decode, encode, generationOf, noteSnapshot} from '../shared/collaboration.mjs';
import {applyBoardPatch} from '../shared/board-patches.mjs';
import * as decoding from 'lib0/decoding';
import {createHash, randomUUID} from 'node:crypto';

export function attachRealtime(server, {read, write, enqueue, maxBytes, updateGate}) {
    const sockets = new WebSocketServer({noServer: true, maxPayload: maxBytes()});
    const rooms = new Map();
    const send = (socket, message) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    };
    const broadcast = (message, except) => {
        for (const socket of sockets.clients) if (socket !== except) send(socket, message);
    };
    const roomFor = name => {
        if (rooms.has(name)) return rooms.get(name);
        const doc = new Y.Doc(), awareness = new Awareness(doc);
        awareness.setLocalState(null);
        const room = {doc, awareness, clients: new Map(), locks: new Map()};
        rooms.set(name, room);
        awareness.on('update', ({added, updated, removed}) => {
            const update = encode(encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]));
            for (const socket of room.clients.keys()) send(socket, {type: 'presence', room: name, update});
        });
        return room;
    };
    const sendLocks = (name, room) => {
        const locks = Object.fromEntries([...room.locks].map(([id, lock]) => [id, {
            owner: lock.socket.session,
            name: lock.name
        }]));
        for (const socket of room.clients.keys()) send(socket, {type: 'locks', room: name, locks});
    };
    const locked = (room, id, socket) => {
        const lock = room.locks.get(id);
        return lock && lock.socket !== socket && lock.expires > Date.now();
    };
    const leave = (socket, name) => {
        const room = rooms.get(name);
        if (!room) return;
        const clientID = room.clients.get(socket);
        room.clients.delete(socket);
        for (const [id, lock] of room.locks) if (lock.socket === socket) room.locks.delete(id);
        sendLocks(name, room);
        if (clientID !== undefined) removeAwarenessStates(room.awareness, [clientID], null);
        if (!room.clients.size) {
            room.awareness.destroy();
            room.doc.destroy();
            rooms.delete(name);
        }
    };
    server.on('upgrade', (request, socket, head) => {
        if (new URL(request.url, 'http://localhost').pathname !== '/realtime') return;
        sockets.handleUpgrade(request, socket, head, client => sockets.emit('connection', client, request));
    });
    sockets.on('connection', socket => {
        send(socket, {type: 'maintenance', ...updateGate?.status()});
        socket.on('message', data => {
            let message;
            try {
                message = JSON.parse(data.toString());
                if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.type !== 'string') throw Error('Invalid message');
            } catch {
                socket.close(1003);
                return;
            }
            if (message.type === 'activity') {
                updateGate?.activity();
                return;
            }
            if (updateGate?.status().updating) {
                send(socket, {type: 'maintenance', ...updateGate.status()});
                return;
            }
            if (message.type === 'hello' && typeof message.id === 'string' && /^[\w-]{1,100}$/.test(message.id)) {
                if (socket.session) return;
                socket.session = message.id;
                const used = new Set([...sockets.clients].filter(peer => peer !== socket).map(peer => peer.color));
                const palette = ['#557db5', '#b16c4d', '#8d68ad', '#398a79', '#a17831', '#a75b83'];
                let color = palette.find(color => !used.has(color)), attempt = 0;
                while (!color || used.has(color)) color = '#' + createHash('sha256').update(message.id + attempt++).digest('hex').slice(0, 6);
                socket.color = color;
                socket.httpToken = randomUUID();
                send(socket, {type: 'identity', color, token: socket.httpToken});
                return;
            }
            if (message.type === 'ping') {
                for (const room of rooms.values()) for (const lock of room.locks.values()) if (lock.socket === socket) lock.expires = Date.now() + 30000;
                send(socket, {type: 'pong'});
                return;
            }
            if (!socket.session || !socket.httpToken) {
                socket.close(1008);
                return;
            }
            if (typeof message.room !== 'string' || message.room.length > 300 || !/^((note)|(board)):[\w-]+$/.test(message.room)) return;
            const name = message.room, [kind, id] = name.split(':');
            if (message.type === 'leave') {
                leave(socket, name);
                return;
            }
            if (message.type === 'join') {
                if (!Number.isSafeInteger(message.clientID) || message.clientID < 0) return;
                void enqueue(async () => {
                    const workspace = await read();
                    const item = workspace?.[kind === 'note' ? 'notes' : 'boards'].find(item => item.id === id);
                    if (!item) {
                        send(socket, {type: 'missing', room: name});
                        return;
                    }
                    if (socket.readyState !== WebSocket.OPEN) return;
                    const room = roomFor(name);
                    if ([...room.clients].some(([peer, id]) => peer !== socket && id === message.clientID)) {
                        send(socket, {type: 'error', room: name});
                        return;
                    }
                    room.clients.set(socket, message.clientID);
                    sendLocks(name, room);
                    send(socket, {
                        type: 'presence',
                        room: name,
                        update: encode(encodeAwarenessUpdate(room.awareness, [...room.awareness.getStates().keys()]))
                    });
                    send(socket, {
                        type: kind === 'note' ? 'note-state' : 'board-state',
                        room: name, ...(kind === 'note' ? {note: item} : {board: item})
                    });
                }).catch(() => send(socket, {type: 'error', room: name}));
                return;
            }
            const room = rooms.get(name);
            if (!room?.clients.has(socket)) return;
            if ((message.type === 'lock' || message.type === 'unlock') && kind === 'board') {
                void enqueue(async () => {
                    if (message.type === 'unlock') {
                        if (room.locks.get(message.objectId)?.socket === socket) {
                            room.locks.delete(message.objectId);
                            sendLocks(name, room);
                        }
                        return;
                    }
                    const workspace = await read(), board = workspace?.boards.find(board => board.id === id),
                        node = board?.nodes.find(node => node.id === message.objectId);
                    if (!node) return;
                    if (node.data.kind === 'note') {
                        send(socket, {type: 'lock-result', room: name, objectId: message.objectId, granted: true});
                        return;
                    }
                    if (locked(room, node.id, socket)) {
                        sendLocks(name, room);
                        send(socket, {type: 'lock-result', room: name, objectId: node.id, granted: false});
                        return;
                    }
                    const user = room.awareness.getStates().get(room.clients.get(socket))?.user;
                    room.locks.set(node.id, {
                        socket,
                        name: String(user?.name || 'User').slice(0, 100),
                        expires: Date.now() + 30000
                    });
                    sendLocks(name, room);
                    send(socket, {type: 'lock-result', room: name, objectId: node.id, granted: true});
                }).catch(() => {
                });
                return;
            }
            if (message.type === 'presence') {
                try {
                    if (typeof message.update !== 'string' || message.update.length > 64000) return;
                    const bytes = decode(message.update), decoder = decoding.createDecoder(bytes);
                    if (decoding.readVarUint(decoder) !== 1 || decoding.readVarUint(decoder) !== room.clients.get(socket)) return;
                    applyAwarenessUpdate(room.awareness, bytes, socket);
                } catch {
                }
                return;
            }
            void enqueue(async () => {
                const workspace = await read();
                if (!workspace) return;
                if (message.type === 'note-update' && kind === 'note') {
                    const index = workspace.notes.findIndex(note => note.id === id);
                    if (index < 0) return;
                    const note = workspace.notes[index];
                    if (typeof message.generation !== 'string' || message.generation !== (note.collaboration?.generation || generationOf(note))) {
                        send(socket, {type: 'note-state', room: name, note});
                        return;
                    }
                    if (typeof message.update !== 'string' || message.update.length > maxBytes() * 1.4) return;
                    const doc = new Y.Doc();
                    try {
                        if (note.collaboration) Y.applyUpdate(doc, decode(note.collaboration.state));
                        Y.applyUpdate(doc, decode(message.update));
                        const next = noteSnapshot({...note, updatedAt: Date.now()}, doc, message.generation);
                        assertDocument(next.content);
                        if (JSON.stringify(next.content).length > maxBytes()) throw Error('Document too large');
                        workspace.notes[index] = next;
                        const etag = await write(workspace);
                        for (const peer of room.clients.keys()) send(peer, {
                            type: 'note-update',
                            room: name,
                            generation: message.generation,
                            update: message.update
                        });
                        broadcast({type: 'workspace', room: name, etag}, socket);
                    } finally {
                        doc.destroy();
                    }
                } else if (message.type === 'board-patch' && kind === 'board') {
                    const index = workspace.boards.findIndex(board => board.id === id);
                    if (index < 0) return;
                    const touched = [...(message.patch?.nodes?.remove || []), ...(message.patch?.nodes?.upsert || []).map(item => item.id)];
                    if (touched.some(objectId => locked(room, objectId, socket))) {
                        send(socket, {type: 'board-denied', room: name, board: workspace.boards[index]});
                        sendLocks(name, room);
                        return;
                    }
                    workspace.boards[index] = applyBoardPatch(workspace.boards[index], message.patch);
                    const etag = await write(workspace);
                    for (const peer of room.clients.keys()) if (peer !== socket) send(peer, {
                        type: 'board-state',
                        room: name,
                        board: workspace.boards[index]
                    });
                    broadcast({type: 'workspace', room: name, etag}, socket);
                }
            }).catch(() => send(socket, {type: 'error', room: name}));
        });
        socket.on('close', () => {
            for (const name of [...rooms.keys()]) leave(socket, name);
        });
        socket.on('error', () => {
        });
    });
    const expiry = setInterval(() => {
        for (const [name, room] of rooms) {
            let changed = false;
            for (const [id, lock] of room.locks) if (lock.expires < Date.now()) {
                room.locks.delete(id);
                changed = true;
            }
            if (changed) sendLocks(name, room);
        }
    }, 2000);
    expiry.unref();
    sockets.on('close', () => clearInterval(expiry));
    return {
        maintenance: state => broadcast({type: 'maintenance', ...state}),
        changed: etag => broadcast({type: 'workspace', etag}),
        checkWorkspace: (previous, candidate, session) => {
            for (const [name, room] of rooms) {
                if (!name.startsWith('board:')) continue;
                const id = name.slice(6), before = previous?.boards.find(board => board.id === id),
                    after = candidate.boards.find(board => board.id === id);
                for (const [objectId, lock] of room.locks) {
                    if (lock.expires < Date.now() || typeof session === 'string' && lock.socket.httpToken === session) continue;
                    if (canonical(before?.nodes.find(node => node.id === objectId)) !== canonical(after?.nodes.find(node => node.id === objectId))) return false;
                }
            }
            return true;
        }
    };
}
