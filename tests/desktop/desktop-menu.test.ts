import {createRequire} from 'node:module';
import {expect, it} from 'vitest';

const require = createRequire(import.meta.url);
const {LinuxTargetHelper} = require('app-builder-lib/out/targets/LinuxTargetHelper.js');
const {desktopMetadata, linuxMenu} = require('../../scripts/desktop/desktop-menu.cjs');

it('generates a visible Ubuntu application entry linked to the installed executable and icon', async () => {
    const helper = new LinuxTargetHelper({
        info: {metadata: desktopMetadata},
        appInfo: {productName: 'Typealot', sanitizedProductName: 'Typealot', description: linuxMenu.description},
        executableName: linuxMenu.executableName,
        platformSpecificBuildOptions: linuxMenu,
        config: {}, fileAssociations: []
    });
    expect(helper.getDesktopFileName()).toBe('app.typealot.editor');
    const entry = await helper.computeDesktopEntry(linuxMenu);
    for (const line of ['[Desktop Entry]', 'Name=Typealot', 'Type=Application', 'Exec=/opt/Typealot/typealot %U',
        'Icon=typealot', 'Terminal=false', 'StartupWMClass=app.typealot.editor', 'Categories=Office;']) {
        expect(entry.split('\n')).toContain(line);
    }
    expect(entry).not.toMatch(/^(Hidden|NoDisplay)=true$/m);
    expect(entry).toContain('Comment[ru]=Редактор заметок и досок');
});
