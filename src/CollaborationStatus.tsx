import {useMemo, useSyncExternalStore} from 'react';
import {t, useLanguage} from './i18n';
import {type Awareness, type RealtimeChannel, useConnection} from './realtime';

export function useParticipants(awareness: Awareness) {
    const subscribe = useMemo(() => (fn: () => void) => {
        awareness.on('change', fn);
        return () => awareness.off('change', fn);
    }, [awareness]);
    const snapshot = () => JSON.stringify([...awareness.getStates()].map(([id, state]) => ({
        id,
        name: String(state.user?.name || '').slice(0, 100),
        color: /^#[\da-f]{6}$/i.test(String(state.user?.color)) ? String(state.user.color) : '#557db5'
    })));
    const data = useSyncExternalStore(subscribe, snapshot, () => '[]');
    return useMemo(() => JSON.parse(data) as { id: number; name: string; color: string }[], [data]);
}

export default function CollaborationStatus({channel, awareness}: {
    channel: RealtimeChannel | null;
    awareness: Awareness
}) {
    useLanguage();
    const status = useConnection(channel), people = useParticipants(awareness);
    if (!channel) return null;
    return <div className="collaboration-status" aria-label={t('collaboration.participants')}>
        <span
            role="status">{status === 'connected' ? t('collaboration.connected') : t('collaboration.reconnecting')}</span>
        {status === 'connected' && people.filter(person => person.id !== awareness.clientID).map(person => <span
            key={person.id} className="collaboration-person"><i
            style={{background: person.color}}/>{person.name}</span>)}
    </div>;
}
