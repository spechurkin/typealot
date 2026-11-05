import type {CapacitorConfig} from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'app.typealot.editor',
    appName: 'Typealot',
    webDir: 'dist',
    android: {minWebViewVersion: 109, allowMixedContent: true},
    server: {hostname: 'app.typealot.editor', androidScheme: 'https'},
    plugins: {CapacitorHttp: {enabled: true}, SystemBars: {insetsHandling: 'native'}}
};
export default config;
