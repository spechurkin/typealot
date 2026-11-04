import {defineConfig} from '@playwright/test';

const port = Number(process.env.TYPEALOT_TEST_PORT || (process.env.TYPEALOT_TEST_PORT = String(20000 + process.pid % 20000)));
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
    testDir: './tests',
    outputDir: `test-results/ui-${port}`,
    testMatch: '**/*.spec.ts',
    fullyParallel: false,
    workers: 1,
    use: {
        baseURL: origin,
        browserName: 'chromium',
        channel: 'msedge',
        headless: true,
        screenshot: 'only-on-failure',
        storageState: {cookies: [], origins: [{origin, localStorage: [{name: 'typealot.language', value: 'ru'}]}]}
    },
    webServer: {command: `npm run dev -- --port ${port}`, url: origin, reuseExistingServer: false},
    reporter: 'list'
});
