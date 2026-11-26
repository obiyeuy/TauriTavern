<div align="center">

<img src="docs/images/tauritavern-readme-hero.webp" alt="TauriTavern Personal" width="720">

# TauriTavern Personal

**Fork do TauriTavern mantido por obiyeuy, com foco no uso do chat no Android e na confiabilidade dos dados locais.**

[简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [Русский](README.ru.md) · **Português (Brasil)**

[Releases](https://github.com/obiyeuy/TauriTavern/releases) · [Desenvolvimento](docs/PersonalDevelopment.md) · [Relatar problemas](https://github.com/obiyeuy/TauriTavern/issues) · [Actions](https://github.com/obiyeuy/TauriTavern/actions)

</div>

## Sobre este fork

O código, os relatos de problemas, as compilações e as versões pessoais ficam em [`obiyeuy/TauriTavern`](https://github.com/obiyeuy/TauriTavern). O trabalho se concentra na interface móvel, na configuração de APIs e no salvamento de chaves, em chats e anexos, na compatibilidade de extensões e em melhorias de desempenho verificadas por medições.

O projeto mantém o backend em Rust e o ecossistema do frontend SillyTavern.

## Instalação e atualizações

O pacote pessoal para Android é `com.tauritavern.personal`, destinado a **Android 8.0+ / ARM64**.

Use as [Releases deste repositório](https://github.com/obiyeuy/TauriTavern/releases). A primeira versão formal ainda está em preparação; um APK está publicado quando aparece entre os arquivos de uma Release. Atualize a instalação pessoal com um APK que use o mesmo pacote e certificado de assinatura.

Stable usa `main` e uma tag de versão fixa. Canary usa `dev` e atualiza a tag `Canary` depois da validação. As atualizações no aplicativo precisam de um repositório público e de uma Release publicada para o canal escolhido. Consulte o [processo de publicação](docs/PersonalDevelopment.md).

Este fork desenvolve, verifica e distribui apenas APKs para Android ARM64. O código de outras plataformas é mantido como material herdado do projeto original.

## Primeiros passos

Crie ou importe um personagem, escolha o provedor de API ou protocolo e preencha os campos separados de URL base, chave de API e ID do modelo. Salve a configuração e teste a conexão. Uma URL base de serviço compatível com OpenAI pode ser `https://api.example.com/v1`; confirme o ID do modelo na documentação do provedor.

Relate falhas nas [Issues deste fork](https://github.com/obiyeuy/TauriTavern/issues), incluindo versão do aplicativo, dispositivo, passos para reproduzir e os erros relevantes. Oculte as chaves de API nas capturas de tela e nos logs.

## Desenvolvimento

Use **Node.js 24 LTS, pnpm 11 e Rust stable**. Para Android, também são necessários **JDK 21, Android SDK 36, NDK r29** e a configuração da assinatura pessoal.

```sh
git clone https://github.com/obiyeuy/TauriTavern.git
cd TauriTavern
pnpm install --frozen-lockfile
pnpm run check
pnpm run android:build:personal
```

Desenvolvimento e CI usam Node.js 24 para aplicar o limite de 60 segundos a cada teste de navegador. Trabalhe em uma branch de tarefa, integre em `dev` após revisão e publique Stable a partir de uma base revisada em `main`.

Consulte [CONTRIBUTING.md](CONTRIBUTING.md), o [guia de desenvolvimento](docs/PersonalDevelopment.md), [Android](docs/AndroidDevelopment.md), a [estrutura do backend](docs/BackendStructure.md) e o [contrato com o host](docs/FrontendHostContract.md).

## Créditos e licença

Este fork é baseado em [Darkatse/TauriTavern](https://github.com/Darkatse/TauriTavern), preservando o histórico Git, a licença e os créditos dos colaboradores. O TauriTavern é construído sobre [SillyTavern](https://github.com/SillyTavern/SillyTavern) e [Tauri](https://tauri.app/).

Agradecemos aos mantenedores originais, autores de extensões, colaboradores e a [@shiyue137](https://github.com/shiyue137) pelo logotipo original. Licenciado sob [AGPL-3.0](LICENSE).
