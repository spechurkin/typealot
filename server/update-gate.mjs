export const IDLE_INTERVAL = 5 * 60 * 1000;
export const SERVER_CHECK_INTERVAL = 6 * 60 * 60 * 1000;

export function createUpdateGate({
                                     now = Date.now, notify = () => {
    }, initialLease = null
                                 } = {}) {
    let lastActivity = now(), pending = 0, lease = initialLease;
    const status = () => {
        if (lease && now() >= lease.expiresAt) {
            lease = null;
            notify({updating: false});
        }
        return {
            updating: !!lease,
            idle: !lease && !pending && now() - lastActivity >= IDLE_INTERVAL,
            updateId: lease?.id,
            expiresAt: lease?.expiresAt,
            lastActivity,
            pending
        };
    };
    return {
        status,
        activity() {
            if (!status().updating) lastActivity = now();
        },
        begin() {
            if (status().updating) return null;
            pending++;
            lastActivity = now();
            let done = false;
            return () => {
                if (!done) {
                    done = true;
                    pending--;
                    lastActivity = now();
                }
            };
        },
        prepare(id) {
            if (status().updating) return lease.id === id;
            if (pending || now() - lastActivity < IDLE_INTERVAL) return false;
            lease = {id, expiresAt: now() + 15 * 60 * 1000};
            notify(status());
            return true;
        },
        cancel(id) {
            if (lease?.id === id) {
                lease = null;
                notify(status());
            }
        }
    };
}
