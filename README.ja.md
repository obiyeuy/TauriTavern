# TauriTavern Personal · Android

Android スマートフォンでキャラクターカードを使って AI と会話するアプリです。**obiyeuy** が保守し、チャット操作、API 設定、ローカルデータの保存、拡張機能の互換性を改善しています。

[简体中文](README.md) · [English](README.en.md) · **日本語** · [Русский](README.ru.md) · [Português (Brasil)](README.pt-BR.md)

[ダウンロードとバージョン](https://github.com/obiyeuy/TauriTavern/releases) · [問題報告](https://github.com/obiyeuy/TauriTavern/issues) · [Android のビルドと検証](https://github.com/obiyeuy/TauriTavern/actions)

## 対象と機能

対象は **Android 8.0 以上、ARM64**。アプリがチャットと設定をローカルで管理し、モデルの応答には利用者が設定した API サービスを使います。

キャラクターカード、チャット、ワールドブック、プリセットには SillyTavern のデータ形式を使用します。モバイル画面、API 入力と接続テスト、保存の確認と再試行、拡張機能・カードスクリプト・メディアの互換性を継続的に改善します。互換性は実装と検証済みの動作に基づきます。

## インストールとスマートフォンでの更新

個人版のパッケージ名は `com.tauritavern.personal`。APK は[このリポジトリの Releases](https://github.com/obiyeuy/TauriTavern/releases)で配布し、ファイル名の末尾は `android-arm64-v8a.apk` です。

**リポジトリは公開済みですが、最初の公開 APK Release とオンライン更新は準備中です。** ローカルビルドや実機へのインストール成功は、Release の公開完了を意味しません。

公開後は最初の APK をインストールし、以後はアプリのバージョン／情報設定から更新を確認します。Release を開いて APK をダウンロードし、Android のインストーラーで更新を承認します。USB 接続は不要です。同じパッケージ名と署名で上書き更新すると、既存のアプリデータを保持できます。

Stable は `main` から固定バージョンを公開し、Canary は `dev` から検証後に `Canary` tag を更新します。[公開手順](docs/PersonalDevelopment.md)を参照してください。

## 使い始める

キャラクターを作成またはインポートし、API の提供元またはプロトコルを選択します。ベース URL、API キー、モデル ID を別々の欄に入力して保存し、接続テストを実行します。ベース URL の例は `https://api.example.com/v1` です。モデルとプロトコルはサービスの説明に従ってください。

404 が出る場合は、最終リクエスト URL、プロトコル、モデル、サーバーの応答を確認します。問題報告にはアプリ・端末・OS のバージョンと再現手順を添え、画像とログの API キーを伏せてください。

## 開発

**Node.js 24、pnpm 11、Rust stable、JDK 21、Android SDK 36、NDK r29** が必要です。個人版の公開には元の署名設定も必要です。

```sh
git clone https://github.com/obiyeuy/TauriTavern.git
cd TauriTavern
pnpm install --frozen-lockfile
pnpm run check
pnpm run android:build:personal
```

作業ブランチで開発し、レビューと Android 品質チェック後に `dev` に統合します。Stable はレビュー済みの `main` から公開します。[開発ガイド](docs/PersonalDevelopment.md)、[Android](docs/AndroidDevelopment.md)、[フロントエンド](docs/FrontendGuide.md)、[ホスト契約](docs/FrontendHostContract.md)、[バックエンド](docs/BackendStructure.md)を参照してください。貢献前に [CONTRIBUTING.md](CONTRIBUTING.md) を確認してください。

## 出典とライセンス

[Darkatse/TauriTavern](https://github.com/Darkatse/TauriTavern) を基に、[SillyTavern](https://github.com/SillyTavern/SillyTavern) と [Tauri](https://tauri.app/) を使用しています。上流の履歴と作者・貢献者のクレジットを保持しています。元のビジュアルデザインは [@shiyue137](https://github.com/shiyue137) によるものです。

[AGPL-3.0](LICENSE) に従って公開しています。
