# AETHER · Admin

Экосистемная админка AETHER. Сейчас реализован модуль работы с **aether-auth**:
организации, уровни доступа, привязка Discord-ролей и глобальные admin-роли.

Стек: Next 16 (App Router) + Tailwind v4 + общий дизайн-система `@aether/ui`.

## Запуск

```bash
# из корня монорепо
npm install
npm run dev -w @aether/admin      # http://localhost:3002
```

Также нужен запущенный сервис **aether-auth**:

```bash
cd ../../../auth
.venv/bin/python -m uvicorn app.main:app --port 8000
```

Переменные окружения админки — см. `.env.example`:

- `AUTH_INTERNAL_URL` — адрес aether-auth со стороны сервера Next (по умолчанию `http://localhost:8000`).
- `NEXT_PUBLIC_AUTH_URL` — оставь пустым: браузер ходит на тот же origin, а Next проксирует.

## Вход (локальный пароль)

Для одного оператора вход сделан по паролю, без Discord:

1. В `auth/.env` задаётся `ADMIN_PASSWORD` (по умолчанию в dev — `aether-admin`, **поменяй**).
2. На экране входа вводишь пароль → `POST /auth/login-password` выдаёт admin-токен
   и ставит refresh-куку.
3. Дальше всё как обычно: токен в памяти, сессия живёт через `POST /auth/refresh`,
   guard (`components/admin-shell.tsx`) пускает только `is_admin`.

## Без CORS — через rewrites

Запросы к `/auth/*` и `/admin/*` идут на тот же origin, что и админка, а Next
проксирует их на `AUTH_INTERNAL_URL` (см. `rewrites` в `next.config.ts`). Поэтому
CORS не нужен и всё работает в т.ч. через code-server proxy.

Полноценный Discord-вход (`/auth/login` → callback) остаётся в API, но для него
понадобится CORS и redirect из `/auth/callback` обратно на админку — сейчас не
требуется.
