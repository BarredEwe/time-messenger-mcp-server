<div align="center">

# 💬 Time Messenger MCP Server

**Подключите корпоративный мессенджер [Time](https://time-messenger.ru/) от Т-Банка к Claude, OpenCode и другим AI-ассистентам**

[![npm version](https://img.shields.io/npm/v/time-messenger-mcp-server?color=cb3837&logo=npm)](https://www.npmjs.com/package/time-messenger-mcp-server)
[![CI](https://github.com/BarredEwe/time-messenger-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/BarredEwe/time-messenger-mcp-server/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/node/v/time-messenger-mcp-server?logo=node.js&logoColor=white&color=339933)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-stdio-6e56cf)](https://modelcontextprotocol.io/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[Быстрый старт](#-быстрый-старт) ·
[Настройка](#-настройка) ·
[Клиенты](#-подключение-к-ai-клиентам) ·
[Инструменты](#-инструменты) ·
[Проблемы](#-если-что-то-не-работает) ·
[Разработка](#-разработка)

</div>

---

Time построен на Mattermost. Этот [MCP](https://modelcontextprotocol.io/)-сервер даёт ассистенту доступ к вашему аккаунту: он читает и отправляет сообщения, разбирает треды, ищет каналы и людей, показывает непрочитанное.

> Попросите, например:
> *«Что важного было в моих каналах за утро?»* ·
> *«Найди тред про релиз и кратко перескажи»* ·
> *«Ответь в треде, что я посмотрю после обеда»*

## ✨ Возможности

| | |
|---|---|
| 📨 **Сообщения** | чтение каналов и тредов, поиск, отправка и ответы в треде |
| 🧵 **Треды** | отслеживаемые треды, статистика непрочитанного, follow / unfollow |
| 📢 **Каналы** | список, поиск, непрочитанное, массовая отметка «прочитано» |
| 👥 **Команды и люди** | команды, непрочитанное по командам, поиск пользователей |
| 🔐 **Авторизация** | Personal Access Token или логин и пароль, поддержка MFA |

## 🚀 Быстрый старт

Нужен **Node.js 20.19+** и Personal Access Token ([как получить](#personal-access-token-рекомендуется)).

**Claude Code** — одной командой:

```bash
claude mcp add time \
  -e TIME_URL=https://your-instance.time-messenger.ru \
  -e TIME_TOKEN=your_token_here \
  -- npx -y time-messenger-mcp-server
```

Для других клиентов — готовые конфиги в разделе [Подключение к AI-клиентам](#-подключение-к-ai-клиентам).

<details>
<summary><b>Другие способы установки</b></summary>

<br>

**Глобально через npm**

```bash
npm install -g time-messenger-mcp-server
time-messenger-mcp-server
```

**Из исходников**

```bash
git clone https://github.com/BarredEwe/time-messenger-mcp-server.git
cd time-messenger-mcp-server
npm install
npm run build
node dist/index.js
```

</details>

## ⚙️ Настройка

### Переменные окружения

| Переменная | Обязательна | Описание |
|---|:---:|---|
| `TIME_URL` | ✅ | Адрес вашего Time, например `https://your-instance.time-messenger.ru` |
| `TIME_TOKEN` | ✅ \* | Personal Access Token |
| `TIME_LOGIN_ID` | ✅ \* | Email или логин |
| `TIME_PASSWORD` | ✅ \* | Пароль, указывается вместе с `TIME_LOGIN_ID` |
| `TIME_REQUEST_TIMEOUT_MS` | — | Таймаут запроса к API в мс, по умолчанию `30000` |
| `TIME_USER_AGENT` | — | Свой User-Agent, если ваш сервер отбрасывает запросы с небраузерным |

\* Нужен либо `TIME_TOKEN`, либо пара `TIME_LOGIN_ID` + `TIME_PASSWORD`. Шаблон со всеми переменными — [`.env.example`](.env.example).

### Способы авторизации

#### Personal Access Token (рекомендуется)

Постоянный токен, который не истекает.

1. Откройте Time в браузере.
2. Аватарка → **Настройки аккаунта** → **Безопасность** → **Персональные токены доступа**.
3. Создайте токен, например с описанием `MCP Server`.
4. Скопируйте его сразу: токен показывается один раз.

#### Логин и пароль

Сервер сам получит токен сессии и сохранит его в `~/.time-mcp/auth.json`, чтобы не входить заново при каждом запуске. Когда сессия истечёт, сервер снова войдёт по логину и паролю.

Если на аккаунте включена **двухфакторная аутентификация**:

1. Первый запрос вернёт ошибку `MFA verification required`.
2. Попросите ассистента вызвать `login_with_mfa` с 6-значным кодом из приложения-аутентификатора.
3. Токен сохранится, и код понадобится снова только после истечения сессии.

#### OAuth2

Не подходит для MCP: требует редиректа в браузере. Если нужен OAuth2 в собственном веб-приложении, смотрите [документацию Time](https://docs.time-messenger.ru/integrations/oauth2_service_provider).

## 🔌 Подключение к AI-клиентам

Сервер работает через **stdio** — стандартный транспорт MCP, поэтому подойдёт любой совместимый клиент.

<details open>
<summary><b>Claude Desktop</b></summary>

<br>

Файл конфигурации:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "time": {
      "command": "npx",
      "args": ["-y", "time-messenger-mcp-server"],
      "env": {
        "TIME_URL": "https://your-instance.time-messenger.ru",
        "TIME_TOKEN": "your_token_here"
      }
    }
  }
}
```

Для входа по логину замените `TIME_TOKEN` на `TIME_LOGIN_ID` и `TIME_PASSWORD`. После правки перезапустите Claude Desktop.

</details>

<details>
<summary><b>Claude Code</b></summary>

<br>

```bash
claude mcp add time \
  -e TIME_URL=https://your-instance.time-messenger.ru \
  -e TIME_TOKEN=your_token_here \
  -- npx -y time-messenger-mcp-server
```

</details>

<details>
<summary><b>OpenCode</b></summary>

<br>

Файл `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "time": {
      "type": "local",
      "command": ["npx", "-y", "time-messenger-mcp-server"],
      "enabled": true,
      "environment": {
        "TIME_URL": "https://your-instance.time-messenger.ru",
        "TIME_TOKEN": "your_token_here"
      }
    }
  }
}
```

</details>

<details>
<summary><b>Другой MCP-клиент</b></summary>

<br>

Укажите команду `npx -y time-messenger-mcp-server` и передайте переменные окружения из [таблицы выше](#переменные-окружения).

</details>

## 🧰 Инструменты

23 инструмента в шести группах.

#### 📨 Сообщения

| Инструмент | Что делает |
|---|---|
| `send_message` | Отправляет сообщение в канал или отвечает в треде |
| `get_channel_messages` | Возвращает сообщения канала с пагинацией |
| `get_thread_messages` | Возвращает все сообщения треда |
| `search_messages` | Ищет сообщения в команде |

#### 🧵 Треды

| Инструмент | Что делает |
|---|---|
| `list_threads` | Список отслеживаемых тредов в команде |
| `get_thread_stats` | Статистика непрочитанных тредов |
| `get_thread` | Информация о треде |
| `follow_thread` | Начинает отслеживать тред |
| `unfollow_thread` | Перестаёт отслеживать тред |
| `mark_thread_read` | Отмечает тред прочитанным |

#### 📢 Каналы

| Инструмент | Что делает |
|---|---|
| `list_channels` | Список каналов в команде |
| `get_channel` | Информация о канале |
| `search_channels` | Ищет каналы |
| `get_channel_unread` | Непрочитанное в канале |
| `mark_channels_read` | ⚠️ Отмечает каналы прочитанными, **без отмены** ([подробнее](#mark_channels_read)) |

#### 👥 Команды

| Инструмент | Что делает |
|---|---|
| `list_teams` | Команды пользователя |
| `get_team` | Информация о команде |
| `get_teams_unread` | Непрочитанное во всех командах |
| `get_team_unread` | Непрочитанное в одной команде |

#### 👤 Пользователи

| Инструмент | Что делает |
|---|---|
| `get_me` | Текущий пользователь |
| `get_user` | Пользователь по ID |
| `search_users` | Ищет пользователей |

#### 🔐 Авторизация

| Инструмент | Что делает |
|---|---|
| `login_with_mfa` | Завершает вход кодом двухфакторной аутентификации |

<a id="mark_channels_read"></a>
<details>
<summary><b>Как работает <code>mark_channels_read</code></b></summary>

<br>

- `mode: "all"` — все доступные каналы: публичные, приватные, личные и групповые.
- `mode: "selected"` — только каналы из переданного непустого списка ID.
- Для каждого уникального канала уходит отдельный запрос Time `/view`. Временные сбои повторяются, а оставшиеся ошибки перечисляются в ответе.
- Отслеживаемые треды не затрагиваются, для них есть `mark_thread_read`.

</details>

## 🩺 Если что-то не работает

| Сообщение | Что сделать |
|---|---|
| `TIME_URL environment variable is required` | Добавьте `TIME_URL` в `env` конфига клиента |
| `Authentication required: set TIME_TOKEN ...` | Укажите `TIME_TOKEN` или пару `TIME_LOGIN_ID` + `TIME_PASSWORD` |
| `MFA verification required` | Вызовите `login_with_mfa` с кодом из аутентификатора ([подробнее](#логин-и-пароль)) |
| `Login failed: 401 ...` | Проверьте логин и пароль или перейдите на Personal Access Token |
| Работает от имени не того аккаунта | Удалите `~/.time-mcp/auth.json` и перезапустите клиент |
| Запросы висят или обрываются | Увеличьте `TIME_REQUEST_TIMEOUT_MS`; если сервер режет небраузерные клиенты, задайте `TIME_USER_AGENT` |

## 🛠 Разработка

```bash
npm install          # зависимости
npm run dev          # запуск из исходников через tsx
npm run build        # сборка в dist/
npm test             # тесты (vitest)
npm run typecheck    # проверка типов
```

<details>
<summary><b>Структура проекта</b></summary>

<br>

```
src/
├── index.ts              # MCP-сервер и регистрация инструментов
├── client/
│   ├── time-client.ts    # клиент Time API
│   └── auth-store.ts     # токен сессии в ~/.time-mcp/auth.json
├── tools/
│   ├── auth.ts           # MFA
│   ├── messages.ts       # сообщения
│   ├── threads.ts        # треды
│   ├── channels.ts       # каналы
│   ├── teams.ts          # команды
│   ├── users.ts          # пользователи
│   └── types.ts          # общие типы инструментов
├── types/
│   └── time-api.ts       # типы ответов Time API
└── __tests__/            # тесты vitest
```

</details>

### Документация Time API

- [API v4](https://docs.time-messenger.ru/api/v4/введение)
- [API v5](https://docs.time-messenger.ru/api/v5/errors)

## 📄 Лицензия

[MIT](LICENSE)
