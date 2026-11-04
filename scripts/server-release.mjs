import {deploymentBundle} from '../electron/ssh-install.cjs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {releaseUrl} from '../shared/updates.mjs';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const base = releaseUrl(process.env.TYPEALOT_RELEASE_URL || 'https://github.com/spechurkin/typealot/releases/download/server-latest/');
const body = await deploymentBundle();
await mkdir('release/server', {recursive: true});
const name = `typealot_server_${pkg.serverVersion}.json.gz`;
await writeFile(`release/server/${name}`, body);
await writeFile('release/server/server.json', JSON.stringify({
    version: pkg.serverVersion,
    url: new URL(name, base).href,
    sha256: createHash('sha256').update(body).digest('hex')
}, null, 2));
