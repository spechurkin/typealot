const fs = require('node:fs/promises');
const path = require('node:path');

function replaceOnce(source, before, after) {
    if (source.split(before).length !== 2) throw new Error('Unsupported electron-builder NSIS template: ' + before);
    return source.replace(before, after);
}

async function prepareUpgradeInclude(directory, include) {
    const templates = path.resolve(path.dirname(require.resolve('app-builder-lib/package.json')), 'templates/nsis');
    let utility = (await fs.readFile(path.join(templates, 'include/installUtil.nsh'), 'utf8')).replace(/\r\n/g, '\n');
    // Keep registry lookup, install scope and KEEP_APP_DATA handling from the upstream implementation.
    // Run the matching uninstaller bundled with this installer instead of executing potentially broken legacy code.
    utility = replaceOnce(utility,
        '!insertmacro copyFile "$uninstallerFileName" "$uninstallerFileNameTemp"',
        'File "/oname=$PLUGINSDIR\\old-uninstaller.exe" "${UNINSTALLER_OUT_FILE}"');
    utility = replaceOnce(utility,
        `    ifErrors TryInPlace CheckResult

    TryInPlace:
      # the execution failed - might have been caused by some group policy restrictions
      # we try to execute the uninstaller in place
      ExecWait '"$uninstallerFileName" /S /KEEP_APP_DATA $0 _?=$installationDir' $R0
      ifErrors DoesNotExist`,
        '    ifErrors DoesNotExist CheckResult');
    utility = replaceOnce(utility,
        '      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY OneMoreAttempt\n      Return',
        '      MessageBox MB_OK|MB_ICONSTOP "$(uninstallFailed): $R0" /SD IDOK\n      SetErrorLevel 2\n      Quit');
    // Repeating the same failed uninstallation hides its actual exit code and cannot repair it.
    utility = replaceOnce(utility, '${if} $R5 > 5', '${if} $R5 > 1');
    utility = replaceOnce(utility, '  OneMoreAttempt:\n', '');
    await fs.mkdir(directory, {recursive: true});
    await fs.cp(templates, directory, {recursive: true});
    const uninstallerPath = path.join(directory, 'uninstaller.nsh');
    let uninstaller = (await fs.readFile(uninstallerPath, 'utf8')).replace(/\r\n/g, '\n');
    // Legacy packages can contain dependency paths beyond MAX_PATH. Rename and rollback
    // must both use the Win32 extended path namespace, including their directory traversal.
    uninstaller = uninstaller.replaceAll('"$INSTDIR$R0', '"\\\\?\\$INSTDIR$R0')
        .replaceAll('"$PLUGINSDIR\\old-install', '"\\\\?\\$PLUGINSDIR\\old-install');
    uninstaller = replaceOnce(uninstaller, '    RMDir /r $INSTDIR',
        '    RMDir /r "\\\\?\\$PLUGINSDIR\\old-install"\n    RMDir /r "\\\\?\\$INSTDIR"');
    uninstaller = replaceOnce(uninstaller, '  !insertmacro CHECK_APP_RUNNING',
        '  FileOpen $R8 "$TEMP\\Typealot-uninstall.log" w\n  FileWrite $R8 "Checking running processes$\\r$\\n"\n  FileClose $R8\n  !insertmacro CHECK_APP_RUNNING\n  FileOpen $R8 "$TEMP\\Typealot-uninstall.log" a\n  FileSeek $R8 0 END\n  FileWrite $R8 "Process check passed$\\r$\\n"\n  FileClose $R8');
    uninstaller = replaceOnce(uninstaller, '        DetailPrint "File is busy, aborting: $R0"',
        '        DetailPrint "File is busy, aborting: $R0"\n        FileOpen $R8 "$TEMP\\Typealot-uninstall.log" a\n        FileSeek $R8 0 END\n        FileWrite $R8 "Cannot move file: $R0$\\r$\\n"\n        FileClose $R8');
    await fs.writeFile(uninstallerPath, uninstaller);
    const utilityPath = path.join(directory, 'installUtil.nsh');
    await fs.writeFile(utilityPath, utility);
    // The compiler checks its current directory before include directories. Keep the standard
    // builder script and its signed-uninstaller generation, replacing only installUtil.nsh.
    const wrapper = path.join(directory, 'typealot.nsh');
    await fs.writeFile(wrapper, `!addincludedir "${templates}"\n!cd "${directory}"\n!include "${include}"\n`);
    return wrapper;
}

module.exports = {prepareUpgradeInclude};
