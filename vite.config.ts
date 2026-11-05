import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {createRequire} from 'node:module';
import {RELEASES_API} from './shared/updates.mjs';

const packageInfo = createRequire(import.meta.url)('./package.json');
const sshBrowser = createRequire(import.meta.url)('./scripts/dev/ssh-browser.cjs');

export default defineConfig({
    optimizeDeps: {entries: ['index.html']},
    define: {
        __APP_VERSION__: JSON.stringify(packageInfo.version),
        __UPDATE_MANIFEST__: JSON.stringify(process.env.TYPEALOT_APP_UPDATE_URL || RELEASES_API)
    },
    plugins: [react(), sshBrowser()],
    server: {
        port: 5173,
        strictPort: true,
        watch: {ignored: ['**/android/**', '**/test-results/**', '**/release/**', '**/.npm-cache/**', '**/.typealot-sync/**']}
    },
    build: {target: 'chrome109', cssTarget: 'chrome109', chunkSizeWarningLimit: 1300}
});
