# Typealot

**Write it down. See how it connects.**

Typealot brings notes and freeform canvases into one workspace. Write a draft, collect reference material,
then lay out the pieces on a canvas. Work on your own device or connect to a shared server to edit together.

[**Download Typealot from Releases**](https://github.com/spechurkin/typealot/releases)

## Start with a note

1. Choose **New note** in the sidebar and give it a title.
2. Start writing. Select text to change its formatting, or type `/` at the beginning of a line to insert a block.
3. Add images, files, and links. YouTube and Spotify links can appear as a link or a player; playback needs internet
   access.
4. Wait for **Saved** before leaving. Typealot saves your changes automatically.

Keep notes and canvases in folders. Use the menu beside an item to rename, move, or delete it,
and search your workspace when you need to find a passage again.

## Bring your notes onto a canvas

Add note cards, text, images, and shapes, then connect them by dragging from any of the four sides of a card.
Arrange a plan, follow a thread, or keep related material in view while you write.

Hold the middle mouse button to pan and use the wheel to zoom. In **Pan** mode, you can also drag with the
left mouse button. Hold **Shift** to select several objects, drag a corner to resize, and use **Layers**
to change their order or visibility.

## Keep a copy you can take with you

Your workspace stays on your device when you work without a server. In **Settings → Backups and transfer**,
choose **Export everything** to save a JSON copy containing your notes, canvases, and attachments.
On another device, choose **Import backup** to bring it across.

Import replaces the current workspace. Typealot offers to export the current version before replacing it.
You can also export a single note as HTML or JSON from its menu, or restore an automatic local backup in Settings.

Keep an exported copy outside the app. Clearing browser data removes both the local workspace and its local backups.
The browser and desktop app have separate local storage.

## Work on the same page

Open **Settings → Synchronization** and enter your Typealot server's IP address or domain.
Use `address:port` for a custom port or `https://your-domain` for a secure connection.
Connect the other devices to the same server. Automatic sync is on by default; choose **Sync now** to run it yourself.

See each other's cursors in notes and pointers on canvases. Keep editing when you lose your connection;
changes sync when you reconnect. If a conflict needs your attention, compare the versions and choose the one to keep.
Typealot saves a local snapshot before replacing it.

## Install Typealot

Open [Releases](https://github.com/spechurkin/typealot/releases) and choose the package for your operating system
and processor under **Assets**, rather than the source-code archive:

- **Windows:** run the `.exe` installer, then open Typealot from Start. Choose `x64` for 64-bit Windows or `ia32` for
  32-bit.
- **macOS:** open the `.dmg` and drag Typealot to Applications. Choose `x64` for Intel or `arm64` for Apple Silicon.
  Requires macOS 12 or later.
- **Ubuntu:** install the `.deb` and open Typealot from the application menu. Choose `x64` for Intel/AMD or `arm64` for
  ARM.
  For a portable Linux version, use AppImage and allow the file to run as a program in its properties.
- **Android:** install the APK. Requires Android 10 or later and an up-to-date Android System WebView.
- **Browser:** open the address of your Typealot server.

## Use your own server

1. In Settings, enable **Administration**.
2. Enter the Linux machine's address, SSH port, username, and password, then choose **Install server**.
3. Compare the displayed SSH key fingerprint with your server's key before continuing.

The server needs systemd and a root account or sudo access. After installation, open its address in a browser
or connect through Synchronization. Port 80 must be reachable from your devices.

The server has no separate sign-in: anyone who can connect can access synchronization and server settings.
Use a trusted network or restrict network access, and set up HTTPS for remote connections.
Server backup settings control how long copies are kept and how many remain; older copies are deleted automatically.

## Make it yours

Choose a theme, interface language, editing preferences, and a name for collaborative work in Settings.
The interface is available in **English and Russian**; your notes stay as you wrote them.

- [Language settings](docs/localization.md)
- [Updating Typealot](docs/updates.md)
