# Publishing Aegis updates

The in-app updater reads the signed `latest.json` asset from the latest GitHub Release at `Leewoii/Aegis-Browser`.

## One-time setup

1. In the GitHub repository, add an Actions secret named `TAURI_SIGNING_PRIVATE_KEY`.
2. Set its value to the entire contents of the local `src-tauri/.tauri/aegis.key` file. Do not commit or share this file.
3. Store a secure backup of that private key. Existing installed apps can only accept updates signed by this key.

## Publishing a version

1. Change the version consistently in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Commit the version change.
3. Create and push a matching tag, for example `v1.1.0`.
4. GitHub Actions builds a signed NSIS installer, uploads it with its signature, and generates `latest.json`.

Installed Aegis Browser instances then show the new version and release notes in the Updates tab. On Windows, choosing Download and install closes Aegis only when the installer is ready, runs the updater in passive mode, and preserves the user profile.
