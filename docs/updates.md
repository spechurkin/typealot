# Updating Typealot

Typealot checks for updates when it starts and every 30 minutes while it is running.
When a new version is available, an in-app notice lets you choose when to install it.
Choose **Later** to hide that notice until the next launch. If the update service is unavailable,
you can keep working.

## Desktop app

1. Choose **Download update** in the notice.
2. Wait for the download, then choose **Update and restart**.
3. Typealot saves your changes and restarts to install the update.

To update manually, close Typealot and download the new package from
[Releases](https://github.com/spechurkin/typealot/releases) for the same operating system and processor.
On macOS, replace Typealot in Applications. On Ubuntu, install the new `.deb`.
For AppImage, replace the old file with the new one.

Updates keep your notes and settings. To keep a separate copy before updating,
open **Settings → Backups and transfer → Export everything**.

## Android

Choose **Download APK** in the notice, open the downloaded file, and confirm installation in Android.
If prompted, allow installation from the source you are using. Install over the existing app
to keep your local data.

You can also download the APK directly from [Releases](https://github.com/spechurkin/typealot/releases).

Releases include the version in both the name and tag: **Android 1.0.1** (`android-1.0.1`),
**Desktop 1.0.1** (`desktop-1.0.1`), and **Server 1.0.1** (`server-1.0.1`). Each version keeps its own downloads.
In Obtainium, use the release-tag filter `^android-[0-9]+\.[0-9]+\.[0-9]+$` to select Android releases.
The `*-latest` prereleases are compatibility feeds for automatic updates in existing installations.

## Browser

When your server has a new version of the web app, Typealot offers to reload the page.
Choose **Update and restart** to save your changes and reload. The page does not reload itself while you edit.

## Your server

The server updates separately from the apps. When automatic updates are configured, it checks for new versions
every six hours and installs them after five minutes of inactivity. Connections pause briefly during installation,
then clients reconnect. Your data and settings stay in place.

If installation fails, the server returns to the previous version. Ask your server administrator to check
that it can reach its update source. Updating a desktop app or APK does not update the server.

[Back to the user guide](../README.md)
