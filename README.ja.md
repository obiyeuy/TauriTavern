<div align="center">

<img src="docs/images/tauritavern-readme-hero.webp" alt="TauriTavern Personal" width="720">

# TauriTavern Personal

**obiyeuy が保守する TauriTavern の fork。Android のチャット操作とローカルデータの信頼性を改善します。**

[简体中文](README.md) · [English](README.en.md) · **日本語** · [Русский](README.ru.md) · [Português (Brasil)](README.pt-BR.md)

[リリース](https://github.com/obiyeuy/TauriTavern/releases) · [開発ガイド](docs/PersonalDevelopment.md) · [問題報告](https://github.com/obiyeuy/TauriTavern/issues) · [Actions](https://github.com/obiyeuy/TauriTavern/actions)

</div>

## この fork について

ソースコード、問題報告、ビルド、個人版リリースは [`obiyeuy/TauriTavern`](https://github.com/obiyeuy/TauriTavern) で管理します。モバイル画面、API 設定とキーの保存、チャットと添付ファイル、拡張機能の互換性、計測に基づく性能改善が中心です。

Rust バックエンドと SillyTavern のフロントエンドを引き継いでいます。

## インストールと更新

個人版 Android のパッケージ名は `com.tauritavern.personal`、対象は **Android 8.0 以上 / ARM64** です。

[このリポジトリの Releases](https://github.com/obiyeuy/TauriTavern/releases) を使用してください。最初の正式リリースは準備中です。実際に Release の添付ファイルとして公開された APK が配布版です。既存の個人版を更新する際は、同じパッケージ名と署名の APK で上書きインストールします。

Stable は `main` の固定バージョン tag、Canary は検証後に更新する `Canary` tag を使用します。アプリ内更新には、公開リポジトリと選択したチャンネルの正式 Release が必要です。[公開手順](docs/PersonalDevelopment.md)をご覧ください。

この fork では Android ARM64 APK の開発、検証、配布のみを行います。他のプラットフォームのコードは、上流から継承したソース資料として保持しています。

## 初めて使う場合

キャラクターを作成またはインポートし、API の提供元またはプロトコルを選択します。ベース URL、API キー、モデル ID をそれぞれの欄に入力して保存し、接続テストを実行します。OpenAI 互換サービスのベース URL の例は `https://api.example.com/v1` です。モデル ID は提供元のドキュメントを確認してください。

問題は[この fork の Issues](https://github.com/obiyeuy/TauriTavern/issues)に、アプリのバージョン、端末、再現手順とエラー情報を添えて報告してください。画像とログの API キーは伏せてください。

## 開発

**Node.js 24 LTS、pnpm 11、Rust stable** を使用します。Android ビルドには **JDK 21、Android SDK 36、NDK r29** と個人版の署名設定も必要です。

```sh
git clone https://github.com/obiyeuy/TauriTavern.git
cd TauriTavern
pnpm install --frozen-lockfile
pnpm run check
pnpm run android:build:personal
```

開発と CI は Node.js 24 に統一し、ブラウザテストの各ケースに 60 秒の制限を適用します。作業ブランチからレビューを経て `dev` に取り込み、Stable はレビュー済みの `main` から公開します。

[CONTRIBUTING.md](CONTRIBUTING.md)、[開発ガイド](docs/PersonalDevelopment.md)、[Android 開発](docs/AndroidDevelopment.md)、[バックエンド構造](docs/BackendStructure.md)、[ホスト契約](docs/FrontendHostContract.md)を参照してください。

## 出典とライセンス

この fork は [Darkatse/TauriTavern](https://github.com/Darkatse/TauriTavern) を基にしており、Git の履歴、ライセンスと貢献者のクレジットを保持しています。TauriTavern は [SillyTavern](https://github.com/SillyTavern/SillyTavern) と [Tauri](https://tauri.app/) を基盤としています。

上流の保守者、拡張機能の作者、貢献者、そしてロゴを作成した [@shiyue137](https://github.com/shiyue137) に感謝します。[AGPL-3.0](LICENSE) に従って公開しています。
