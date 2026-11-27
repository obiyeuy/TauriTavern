# TauriTavern Personal · Android

Use character cards for AI conversations on your Android phone. Maintained by **obiyeuy**, with ongoing improvements to chat usability, API configuration, local data and extension compatibility.

[简体中文](README.md) · **English** · [日本語](README.ja.md) · [Русский](README.ru.md) · [Português (Brasil)](README.pt-BR.md)

[Downloads and versions](https://github.com/obiyeuy/TauriTavern/releases) · [Report an issue](https://github.com/obiyeuy/TauriTavern/issues) · [Android builds and checks](https://github.com/obiyeuy/TauriTavern/actions) · [Development guide](docs/PersonalDevelopment.md)

## About this project

The personal edition targets **Android 8.0+ and ARM64**. The app manages chats and settings locally; model responses come from the API service you configure.

- Import character cards, chats, world books and presets using the SillyTavern data formats.
- Improve chat navigation, input, settings, narrow-screen layouts and loading feedback.
- Configure service URLs, protocols, keys and model IDs; use connection tests and request details to diagnose errors.
- Improve confirmed configuration, chat and attachment writes, failure reporting and retries.
- Investigate compatibility through actual extensions, card scripts and media-loading flows.
- Measure performance and keep state ownership and implementation paths clear.

Compatibility follows the implemented and verified behavior. Report specific provider, card and extension problems in this repository.

## Downloads and phone updates

Personal APKs are published in [this repository's Releases](https://github.com/obiyeuy/TauriTavern/releases). Look for a filename ending in `android-arm64-v8a.apk`.

**The repository is public; the first public APK Release and online update channel are still being prepared.** A successful local build or device installation does not mean a Release has been published.

Once publishing is ready, install the first APK from this repository. For later updates, check the app's version/about settings, open the Release, download its APK and confirm the upgrade in Android's installer. This works directly on the phone without USB.

| Item | Personal edition |
| --- | --- |
| Package | `com.tauritavern.personal` |
| Platform | Android 8.0+, ARM64 |
| Stable | A fixed version built from `main` |
| Canary | A test build from `dev`, using the rolling `Canary` tag |

Upgrade with the same package and signing certificate to retain existing app data. See the [publishing procedure](docs/PersonalDevelopment.md#github-更新发布).

## Getting started

Create or import a character. In API settings, choose a provider or protocol and fill in the service base URL, API key and model ID separately. Save the settings and run the connection test before chatting.

A provider's base URL may look like `https://api.example.com/v1`. Use its documented model ID and protocol. For a 404, check the final request URL, protocol, model and server response. Include your app version, phone, operating system and reproduction steps in an issue; redact credentials from screenshots and logs.

## Development

Use **Node.js 24, pnpm 11, Rust stable, JDK 21, Android SDK 36 and NDK r29**. Personal releases also require the original signing configuration.

```sh
git clone https://github.com/obiyeuy/TauriTavern.git
cd TauriTavern
pnpm install --frozen-lockfile
pnpm run check
pnpm run android:build:personal
```

Work on a task branch and integrate into `dev` after review and Android quality checks. Stable releases use a reviewed `main` baseline. Validate the APK's version, signature, source revision and SHA256 together.

See [personal development](docs/PersonalDevelopment.md), [Android debugging](docs/AndroidDevelopment.md), [frontend guidance](docs/FrontendGuide.md), the [host contract](docs/FrontendHostContract.md), [backend architecture](docs/BackendStructure.md) and [update channels](docs/CurrentState/UpdateChannels.md).

Read [CONTRIBUTING.md](CONTRIBUTING.md) before contributing. When using AI assistance, explain the changes and your understanding in your own words.

## Credits and license

Based on [Darkatse/TauriTavern](https://github.com/Darkatse/TauriTavern), using [SillyTavern](https://github.com/SillyTavern/SillyTavern) and [Tauri](https://tauri.app/). Upstream history and contributor attribution are retained; the original visual identity was designed by [@shiyue137](https://github.com/shiyue137).

Licensed under [AGPL-3.0](LICENSE).
