import {type CSSProperties, useMemo, useSyncExternalStore} from 'react';
import {MousePointer2} from 'lucide-react';
import {useViewport} from '@xyflow/react';
import type {Awareness} from '../sync/realtime';

export default function CanvasPresence({awareness}: { awareness: Awareness }) {
    const viewport = useViewport();
    const subscribe = useMemo(() => (fn: () => void) => {
        awareness.on('change', fn);
        return () => awareness.off('change', fn);
    }, [awareness]);
    const snapshot = () => JSON.stringify([...awareness.getStates()].filter(([id]) => id !== awareness.clientID).map(([id, state]) => ({
        id,
        pointer: state.pointer,
        user: state.user
    })));
    const data = useSyncExternalStore(subscribe, snapshot, () => '[]');
    const people = JSON.parse(data) as {
        id: number;
        pointer?: { x: number; y: number };
        user?: { name: string; color: string }
    }[];
    return <div className="canvas-presence"
                aria-hidden="true">{people.filter(peer => Number.isFinite(peer.pointer?.x) && Number.isFinite(peer.pointer?.y)).map(peer => {
        const name = typeof peer.user?.name === 'string' ? peer.user.name.slice(0, 100) : '',
            color = /^#[\da-f]{6}$/i.test(peer.user?.color || '') ? peer.user!.color : '#557db5';
        return <div key={peer.id} className="remote-pointer" data-user={name} style={{
            '--peer-color': color,
            transform: `translate(${peer.pointer!.x * viewport.zoom + viewport.x}px,${peer.pointer!.y * viewport.zoom + viewport.y}px)`,
            color
        } as CSSProperties}>
            <MousePointer2 size={22} fill="currentColor"/><span>{name}</span>
        </div>;
    })}</div>;
}
