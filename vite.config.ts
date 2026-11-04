import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {createRequire} from 'node:module';

const packageInfo = createRequire(import.meta.url)('./package.json');
const sshBrowser = createRequire(import.meta.url)('./scripts/ssh-browser.cjs');

export default defineConfig({
    optimizeDeps: {entries: ['index.html']},
    define: {
        __APP_VERSION__: JSON.stringify(packageInfo.version),
        __UPDATE_MANIFEST__: JSON.stringify(process.env.TYPEALOT_APP_UPDATE_URL || 'https://github.com/spechurkin/typealot/releases/download/android-latest/apps.json')
    },
    plugins: [react(), sshBrowser()],
    server: {
        port: 5173,
        strictPort: true,
        watch: {ignored: ['**/android/**', '**/test-results/**', '**/.typealot-sync/**']}
    },
    build: {target: 'chrome109', cssTarget: 'chrome109', chunkSizeWarningLimit: 1300}
});
