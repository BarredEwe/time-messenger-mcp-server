# time-messenger-mcp-server

MCP (Model Context Protocol) сервер для корпоративного мессенджера [Time Messenger](https://time-messenger.ru/) (на базе Mattermost) от Т-Банка.

Позволяет AI-ассистентам (Claude, OpenCode и др.) работать с Time Messenger: читать и отправлять сообщения, управлять тредами, искать каналы и пользователей, отслеживать непрочитанные сообщения.

## Установка

### Вариант 1: npx (без установки)

```bash
npx time-messenger-mcp-server
```

### Вариант 2: глобальная установка

```bash
npm install -g time-messenger-mcp-server
time-messenger-mcp-server
```

### Вариант 3: из исходников

```bash
git clone https://github.com/BarredEwe/time-messenger-mcp-server.git
cd time-messenger-mcp-server
npm install
npm run build
node dist/index.js
```

## Настройка

### Переменные окружения

| Переменная | Описание | Обязательно |
|---|---|---|
| `TIME_URL` | URL вашего экземпляра Time Messenger | Да |
| `TIME_TOKEN` | Personal Access Token | Один из способов |
| `TIME_LOGIN_ID` | Email или логин | Один из способов |
| `TIME_PASSWORD` | Пароль | Вместе с LOGIN_ID |
| `TIME_REQUEST_TIMEOUT_MS` | Таймаут запроса к API, мс (по умолчанию `30000`) | Нет |
| `TIME_USER_AGENT` | Переопределить User-Agent для запросов к API | Нет |

### Способ 1: Personal Access Token (рекомендуется)

Personal Access Token — постоянный токен, который не истекает.

**Как получить:**

1. Откройте Time Messenger в браузере
2. Аватарка → **Настройки аккаунта** → **Безопасность** → **Персональные токены доступа**
3. Создайте токен с описанием "MCP Server"
4. Скопируйте токен (показывается только один раз!)

### Способ 2: Логин и пароль

Токен сессии получается автоматически. Если включена MFA — потребуется ввести код через tool `login_with_mfa`.

### Способ 3: OAuth2

Только для веб-приложений (требует браузерный редирект). [Документация](https://docs.time-messenger.ru/integrations/oauth2_service_provider)

## Интеграция с AI-клиентами

### Claude Desktop

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

С токеном:
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

С логином/паролем:
```json
{
  "mcpServers": {
    "time": {
      "command": "npx",
      "args": ["-y", "time-messenger-mcp-server"],
      "env": {
        "TIME_URL": "https://your-instance.time-messenger.ru",
        "TIME_LOGIN_ID": "your@email.com",
        "TIME_PASSWORD": "your_password"
      }
    }
  }
}
```

### OpenCode

`~/.config/opencode/opencode.json`:

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

### Любой MCP-совместимый клиент

```bash
npx time-messenger-mcp-server
```

Сервер использует stdio transport — стандартный для MCP.

## Доступные инструменты

### Аутентификация

| Инструмент | Описание |
|---|---|
| `login_with_mfa` | Ввести MFA код при двухфакторной авторизации |

### Сообщения

| Инструмент | Описание |
|---|---|
| `send_message` | Отправить сообщение в канал или ответить в треде |
| `get_channel_messages` | Получить сообщения из канала (с пагинацией) |
| `get_thread_messages` | Получить все сообщения в треде |
| `search_messages` | Поиск сообщений в команде |

### Треды

| Инструмент | Описание |
|---|---|
| `list_threads` | Список отслеживаемых тредов в команде |
| `get_thread_stats` | Статистика непрочитанных тредов |
| `get_thread` | Информация о конкретном треде |
| `follow_thread` | Начать отслеживание треда |
| `unfollow_thread` | Прекратить отслеживание треда |
| `mark_thread_read` | Отметить тред как прочитанный |

### Каналы

| Инструмент | Описание |
|---|---|
| `list_channels` | Список каналов в команде |
| `get_channel` | Информация о канале |
| `search_channels` | Поиск каналов |
| `get_channel_unread` | Непрочитанные сообщения в канале |

### Команды

| Инструмент | Описание |
|---|---|
| `list_teams` | Список команд пользователя |
| `get_team` | Информация о команде |
| `get_teams_unread` | Непрочитанные во всех командах |
| `get_team_unread` | Непрочитанные в конкретной команде |

### Пользователи

| Инструмент | Описание |
|---|---|
| `get_me` | Информация о текущем пользователе |
| `get_user` | Информация о пользователе по ID |
| `search_users` | Поиск пользователей |

## MFA (двухфакторная аутентификация)

Если на вашем аккаунте включена MFA:

1. При первом запросе получите ошибку: `MFA verification required`
2. Используйте инструмент `login_with_mfa` с 6-значным кодом из аутентификатора
3. После успешного ввода все инструменты будут работать до конца сессии

## Разработка

```bash
# Установка зависимостей
npm install

# Сборка
npm run build

# Разработка
npm run dev

# Проверка типов
npm run typecheck
```

## Структура проекта

```
src/
├── index.ts              # MCP сервер
├── client/
│   └── time-client.ts    # Time API клиент
├── tools/
│   ├── auth.ts           # MFA аутентификация
│   ├── messages.ts       # Сообщения
│   ├── threads.ts        # Треды
│   ├── channels.ts       # Каналы
│   ├── teams.ts          # Команды
│   ├── users.ts          # Пользователи
│   └── types.ts          # Типы инструментов
└── types/
    └── time-api.ts       # TypeScript типы для Time API
```

## API документация

- [Time Messenger API v4](https://docs.time-messenger.ru/api/v4/введение)
- [Time Messenger API v5](https://docs.time-messenger.ru/api/v5/errors)

## Требования

- Node.js 18+

## Лицензия

MIT
