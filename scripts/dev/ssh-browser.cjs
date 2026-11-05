const {installServer, inspectServer} = require('../../electron/ssh-install.cjs');

function sshMiddleware({localOnly = true} = {}) {
    let installing = false;
    return async (req, res, next) => {
        const pathname = req.url?.split('?')[0];
        if (!['/__typealot/ssh', '/__typealot/ssh/probe', '/__typealot/ssh/install'].includes(pathname)) return next();
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'application/json');
        const send = (status, value) => {
            res.statusCode = status;
            res.end(JSON.stringify(value));
        };
        const host = req.headers.host;
        const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
        if (typeof host !== 'string' || (localOnly && (!local || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)))) {
            send(403, {ok: false, error: 'unavailable'});
            return;
        }
        if (pathname === '/__typealot/ssh' && req.method === 'GET') {
            send(200, {available: true});
            return;
        }
        let sameOrigin = false;
        try {
            const origin = new URL(req.headers.origin);
            sameOrigin = ['http:', 'https:'].includes(origin.protocol) && origin.host === host;
        } catch {
        }
        if (req.method !== 'POST' || !sameOrigin || req.headers['content-type'] !== 'application/json') {
            send(403, {ok: false, error: 'unavailable'});
            return;
        }
        if (installing) {
            send(409, {ok: false, error: 'unavailable'});
            return;
        }
        const controller = new AbortController();
        const cancel = () => {
            if (!res.writableEnded) controller.abort();
        };
        res.once('close', cancel);
        let input, ownsInstallation = false;
        try {
            let body = '';
            for await(const chunk of req) {
                body += chunk.toString();
                if (body.length > 16384) throw Error('invalidInput');
            }
            try {
                input = JSON.parse(body);
            } catch {
                throw Error('invalidInput');
            }
            if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('invalidInput');
            if (pathname === '/__typealot/ssh/probe') {
                const fingerprint = await inspectServer(input);
                send(200, {ok: true, fingerprint});
                return;
            }
            if (typeof input.fingerprint !== 'string' || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(input.fingerprint)) throw Error('invalidInput');
            if (installing) throw Error('unavailable');
            installing = true;
            ownsInstallation = true;
            const result = await installServer(input, ({fingerprint}) => fingerprint === input.fingerprint, {signal: controller.signal});
            send(200, {ok: true, ...result});
        } catch (error) {
            const code = ['invalidInput', 'buildMissing', 'cancelled', 'timeout', 'installFailed', 'unavailable'].includes(error.message) ? error.message : error.level === 'client-authentication' ? 'authenticationFailed' : 'connectionFailed';
            if (!res.destroyed) send(200, {ok: false, error: code, detail: error.detail || ''});
        } finally {
            if (input) input.password = '';
            if (ownsInstallation) installing = false;
            res.removeListener('close', cancel);
        }
    };
}

module.exports = () => ({
    name: 'typealot-local-ssh', configureServer(server) {
        server.middlewares.use(sshMiddleware());
    }, configurePreviewServer(server) {
        server.middlewares.use(sshMiddleware());
    }
});
module.exports.sshMiddleware = sshMiddleware;
