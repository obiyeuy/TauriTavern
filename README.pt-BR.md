# TauriTavern Personal · Android

Converse com IA usando cartões de personagens no seu Android. Mantido por **obiyeuy**, com melhorias contínuas no chat, na configuração de APIs, nos dados locais e na compatibilidade de extensões.

[简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [Русский](README.ru.md) · **Português (Brasil)**

[Downloads e versões](https://github.com/obiyeuy/TauriTavern/releases) · [Relatar problemas](https://github.com/obiyeuy/TauriTavern/issues) · [Compilações e verificações Android](https://github.com/obiyeuy/TauriTavern/actions)

## Objetivo

A edição pessoal é destinada a **Android 8.0+ e ARM64**. O aplicativo gerencia chats e configurações localmente; as respostas do modelo vêm do serviço de API configurado pelo usuário.

Cartões, chats, livros de mundo e predefinições usam os formatos do SillyTavern. O trabalho se concentra na navegação móvel, na entrada de parâmetros de API, nos testes de conexão, na confirmação de gravações, nas novas tentativas e na compatibilidade de extensões, scripts de cartões e mídia. A compatibilidade acompanha o comportamento implementado e verificado.

## Instalação e atualização no telefone

O pacote é `com.tauritavern.personal`. Os APKs são publicados nas [Releases deste repositório](https://github.com/obiyeuy/TauriTavern/releases); o nome termina em `android-arm64-v8a.apk`.

**O repositório já é público; a primeira Release pública com APK e as atualizações online ainda estão em preparação.** Uma compilação local ou instalação bem-sucedida no telefone não significa que a Release foi publicada.

Quando a publicação estiver pronta, instale o primeiro APK deste repositório. Depois, verifique atualizações nas configurações de versão/sobre do aplicativo, abra a Release, baixe o APK e confirme a atualização no instalador do Android. Não é necessário USB. Atualizações com o mesmo pacote e certificado preservam os dados existentes do aplicativo.

Stable publica uma versão fixa a partir de `main`. Canary usa `dev` e atualiza a tag `Canary` após validação. Veja o [processo de publicação](docs/PersonalDevelopment.md).

## Primeiros passos

Crie ou importe um personagem. Escolha o provedor ou protocolo de API e preencha separadamente a URL base, a chave de API e o ID do modelo. Salve e teste a conexão. Uma URL base pode ser `https://api.example.com/v1`; use o modelo e o protocolo documentados pelo serviço.

Em caso de 404, confira a URL final da requisição, o protocolo, o modelo e a resposta do servidor. Inclua a versão do aplicativo, o telefone, o sistema operacional e os passos para reproduzir em um relato. Oculte credenciais nas capturas de tela e nos logs.

## Desenvolvimento

Para o ambiente local, recomendamos **Node.js 24, pnpm 11 e Rust stable**. Compilações Android exigem **JDK 21, Android SDK 36 e NDK r29**; releases pessoais também exigem a configuração original de assinatura.

```sh
git clone https://github.com/obiyeuy/TauriTavern.git
cd TauriTavern
pnpm install --frozen-lockfile
pnpm run check
pnpm run android:build:personal
```

Desenvolva em uma branch de tarefa e integre em `dev` após revisão e verificações Android. Stable usa uma base revisada em `main`. Consulte [desenvolvimento](docs/PersonalDevelopment.md), [Android](docs/AndroidDevelopment.md), [frontend](docs/FrontendGuide.md), [contrato com o host](docs/FrontendHostContract.md) e [arquitetura](docs/BackendStructure.md). Leia [CONTRIBUTING.md](CONTRIBUTING.md) antes de contribuir.

## Créditos e licença

Baseado em [Darkatse/TauriTavern](https://github.com/Darkatse/TauriTavern), usando [SillyTavern](https://github.com/SillyTavern/SillyTavern) e [Tauri](https://tauri.app/). O histórico e os créditos dos autores e colaboradores originais são preservados. A identidade visual original foi criada por [@shiyue137](https://github.com/shiyue137).

Licenciado sob [AGPL-3.0](LICENSE).
