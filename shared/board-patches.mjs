import {canonical} from './collaboration.mjs';

const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const transient = new Set(['selected', 'dragging', 'measured', 'resizing', 'draggable', 'deletable']);
const clean = item => Object.fromEntries(Object.entries(item).filter(([key]) => !transient.has(key)));

function changes(before, after, path = [], output = []) {
    for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
        if (forbidden.has(key)) continue;
        const left = before?.[key], right = after?.[key];
        if (canonical(left) === canonical(right)) continue;
        if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) changes(left, right, [...path, key], output);
        else output.push(right === undefined ? {path: [...path, key], remove: true} : {
            path: [...path, key],
            value: right
        });
    }
    return output;
}

function diffItems(before, after) {
    const previous = new Map(before.map(item => [item.id, clean(item)]));
    const next = new Map(after.map(item => [item.id, clean(item)]));
    return {
        remove: [...previous.keys()].filter(id => !next.has(id)), upsert: [...next].flatMap(([id, item]) => {
            if (!previous.has(id)) return [{id, create: item}];
            const patch = changes(previous.get(id), item);
            return patch.length ? [{id, changes: patch}] : [];
        })
    };
}

export function diffBoard(before, after) {
    const nodes = diffItems(before.nodes, after.nodes), edges = diffItems(before.edges, after.edges);
    const patch = {nodes, edges, ...(before.title !== after.title ? {title: after.title} : {})};
    return nodes.remove.length || nodes.upsert.length || edges.remove.length || edges.upsert.length || patch.title !== undefined ? patch : null;
}

function applyItems(items, patch) {
    const result = new Map(items.map(item => [item.id, structuredClone(item)]));
    for (const id of patch?.remove || []) result.delete(id);
    for (const item of patch?.upsert || []) {
        if (typeof item.id !== 'string') throw Error('Invalid board patch');
        if (item.create) {
            if (item.create.id !== item.id) throw Error('Invalid board identity');
            result.set(item.id, structuredClone(item.create));
            continue;
        }
        const object = result.get(item.id);
        if (!object) continue;
        for (const change of item.changes || []) {
            if (!Array.isArray(change.path) || !change.path.length || change.path.length > 12 || change.path[0] === 'id' || change.path.some(key => typeof key !== 'string' || forbidden.has(key))) throw Error('Invalid board path');
            let target = object;
            for (const key of change.path.slice(0, -1)) {
                if (!target[key] || typeof target[key] !== 'object') target[key] = {};
                target = target[key];
            }
            const key = change.path.at(-1);
            if (change.remove) delete target[key]; else target[key] = structuredClone(change.value);
        }
    }
    return [...result.values()];
}

export function applyBoardPatch(board, patch) {
    const nodes = applyItems(board.nodes, patch.nodes), ids = new Set(nodes.map(n => n.id));
    const edges = applyItems(board.edges, patch.edges).filter(e => ids.has(e.source) && ids.has(e.target));
    return {
        ...board, ...(typeof patch.title === 'string' ? {title: patch.title} : {}),
        nodes: nodes.map(n => n.parentId && !ids.has(n.parentId) ? {...n, parentId: undefined} : n),
        edges
    };
}
