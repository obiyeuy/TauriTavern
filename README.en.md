<div align="center">

<img src="docs/images/tauritavern-readme-hero.webp" alt="TauriTavern Personal" width="720">

# TauriTavern Personal

**A TauriTavern fork maintained by obiyeuy, focused on Android chat usability and reliable local data.**

[简体中文](README.md) · **English** · [日本語](README.ja.md) · [Русский](README.ru.md) · [Português (Brasil)](README.pt-BR.md)

[Releases](https://github.com/obiyeuy/TauriTavern/releases) · [Development guide](docs/PersonalDevelopment.md) · [Issues](https://github.com/obiyeuy/TauriTavern/issues) · [Actions](https://github.com/obiyeuy/TauriTavern/actions)

[![Android](https://img.shields.io/badge/Android-8.0%2B-3DDC84?style=flat-square&logo=android&logoColor=white)](#installation-and-updates)
[![Architecture](https://img.shields.io/badge/APK-ARM64-1f9d96?style=flat-square)](#installation-and-updates)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square)](LICENSE)

</div>

## This fork

Source code, issue reports, builds and personal releases belong to [`obiyeuy/TauriTavern`](https://github.com/obiyeuy/TauriTavern).

Development focuses on mobile navigation and input, API configuration and secret persistence, chat and attachment writes, extension compatibility, measured performance improvements, and personal Stable / Canary updates. The project retains the Rust backend and the SillyTavern frontend ecosystem.

## Installation and updates

The personal Android package is `com.tauritavern.personal`, targeting **Android 8.0+ / ARM64**.

Use this repository's [Releases](https://github.com/obiyeuy/TauriTavern/releases). The first formal release is still being prepared; an APK is published only when it appears as an actual Release asset. Upgrade an existing personal installation with an APK using the same package and signing certificate.

| Channel | Source branch | Release |
| --- | --- | --- |
| Stable | `main` | An immutable version tag |
| Canary | `dev` | The rolling `Canary` tag after validation |

In-app update checks require a public repository and a published release for the selected channel. See the [personal publishing procedure](docs/PersonalDevelopment.md).

This fork develops, verifies and releases Android ARM64 APKs. Other platform sources are retained as inherited project material.

## Getting started

Import or create a character, choose your API provider or protocol, and enter the service base URL, API key and model ID in their separate fields. Save the configuration and run the connection test. For a custom OpenAI-compatible provider, a base URL commonly looks like `https://api.example.com/v1`; use the provider's documented model ID.

Report problems in [this fork's Issues](https://github.com/obiyeuy/TauriTavern/issues), including the app version, device, reproduction steps and relevant errors. Redact API credentials in screenshots and logs.

## Development

Use **Node.js 24 LTS, pnpm 11 and Rust stable**. Android builds additionally require **JDK 21, Android SDK 36, NDK r29** and the personal signing configuration.

```sh
git clone https://github.com/obiyeuy/TauriTavern.git
cd TauriTavern
pnpm install --frozen-lockfile
pnpm run check
pnpm run android:build:personal
```

Development and CI use Node.js 24 so the browser runner applies the 60-second timeout to individual tests. The full check includes frontend boundaries, types, lint, browser and contract tests, UI tests, Rust tests and Clippy.

Work on a task branch, review into `dev`, and promote a reviewed baseline to `main` for Stable releases. Follow [CONTRIBUTING.md](CONTRIBUTING.md) and the [personal development guide](docs/PersonalDevelopment.md).

## Documentation

- [Android development](docs/AndroidDevelopment.md)
- [Backend structure](docs/BackendStructure.md)
- [Frontend guide](docs/FrontendGuide.md)
- [Frontend host contract](docs/FrontendHostContract.md)
- [Update channels](docs/CurrentState/UpdateChannels.md)
- [Current implementation](docs/CurrentState/README.md)

## Credits and license

This fork is based on [Darkatse/TauriTavern](https://github.com/Darkatse/TauriTavern), retaining its Git history, license and contributor attribution. TauriTavern builds on [SillyTavern](https://github.com/SillyTavern/SillyTavern) and [Tauri](https://tauri.app/).

Thanks to the upstream maintainers, extension authors, contributors and [@shiyue137](https://github.com/shiyue137) for the original logo.

Licensed under [AGPL-3.0](LICENSE).
