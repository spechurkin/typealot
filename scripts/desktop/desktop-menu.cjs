const desktopMetadata = {
    desktopName: 'app.typealot.editor.desktop',
    homepage: 'https://github.com/spechurkin/typealot'
};

const linuxMenu = {
    target: ['deb', 'AppImage'],
    executableName: 'typealot',
    icon: 'public/icons/icon-512.png',
    category: 'Office',
    synopsis: 'Notes and boards',
    description: 'Typealot notes and boards editor',
    desktop: {entry: {'Name[ru]': 'Typealot', 'Comment[ru]': 'Редактор заметок и досок'}},
    syncDesktopName: true
};

module.exports = {desktopMetadata, linuxMenu};
