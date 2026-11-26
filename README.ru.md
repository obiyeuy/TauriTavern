<div align="center">

<img src="docs/images/tauritavern-readme-hero.webp" alt="TauriTavern Personal" width="720">

# TauriTavern Personal

**Форк TauriTavern, поддерживаемый obiyeuy: удобный чат на Android и надёжное хранение локальных данных.**

[简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · **Русский** · [Português (Brasil)](README.pt-BR.md)

[Релизы](https://github.com/obiyeuy/TauriTavern/releases) · [Разработка](docs/PersonalDevelopment.md) · [Сообщить о проблеме](https://github.com/obiyeuy/TauriTavern/issues) · [Actions](https://github.com/obiyeuy/TauriTavern/actions)

</div>

## Об этом форке

Исходный код, сообщения об ошибках, сборки и персональные релизы размещаются в [`obiyeuy/TauriTavern`](https://github.com/obiyeuy/TauriTavern). Основные направления — мобильный интерфейс, настройка API и сохранение ключей, чаты и вложения, совместимость расширений и улучшение производительности на основе измерений.

Проект сохраняет серверную часть на Rust и экосистему интерфейса SillyTavern.

## Установка и обновления

Персональная версия Android использует пакет `com.tauritavern.personal` и предназначена для **Android 8.0+ / ARM64**.

Используйте [Releases этого репозитория](https://github.com/obiyeuy/TauriTavern/releases). Первый официальный релиз ещё готовится; опубликованной сборкой считается APK, доступный среди файлов Release. Обновляйте установленную персональную версию APK с тем же именем пакета и сертификатом подписи.

Stable выпускается из `main` с неизменяемым тегом версии. Canary собирается из `dev` и обновляет тег `Canary` после проверки. Для проверки обновлений в приложении нужны публичный репозиторий и опубликованный Release выбранного канала. Подробности — в [руководстве по публикации](docs/PersonalDevelopment.md).

В этом форке разрабатываются, проверяются и выпускаются только APK для Android ARM64. Код других платформ сохраняется как унаследованные исходные материалы проекта.

## Начало работы

Создайте или импортируйте персонажа, выберите поставщика API либо протокол и заполните отдельные поля базового URL, ключа API и ID модели. Сохраните настройки и проверьте соединение. Пример базового URL OpenAI-совместимого сервиса: `https://api.example.com/v1`. ID модели уточняйте в документации поставщика.

Сообщайте об ошибках в [Issues этого форка](https://github.com/obiyeuy/TauriTavern/issues), указав версию приложения, устройство, шаги воспроизведения и текст ошибки. Скрывайте ключи API на снимках экрана и в логах.

## Разработка

Используйте **Node.js 24 LTS, pnpm 11 и Rust stable**. Для Android также нужны **JDK 21, Android SDK 36, NDK r29** и настройки персональной подписи.

```sh
git clone https://github.com/obiyeuy/TauriTavern.git
cd TauriTavern
pnpm install --frozen-lockfile
pnpm run check
pnpm run android:build:personal
```

Разработка и CI используют Node.js 24, применяя ограничение в 60 секунд к каждому браузерному тесту. Изменения проходят проверку в рабочей ветке и включаются в `dev`; Stable выпускается из проверенного `main`.

См. [CONTRIBUTING.md](CONTRIBUTING.md), [процесс разработки](docs/PersonalDevelopment.md), [Android](docs/AndroidDevelopment.md), [структуру серверной части](docs/BackendStructure.md) и [контракт интерфейса с хостом](docs/FrontendHostContract.md).

## Авторы и лицензия

Форк основан на [Darkatse/TauriTavern](https://github.com/Darkatse/TauriTavern) и сохраняет его историю Git, лицензию и указание авторства. TauriTavern использует [SillyTavern](https://github.com/SillyTavern/SillyTavern) и [Tauri](https://tauri.app/).

Благодарим разработчиков исходного проекта, авторов расширений, участников и [@shiyue137](https://github.com/shiyue137) за оригинальный логотип. Лицензия — [AGPL-3.0](LICENSE).
