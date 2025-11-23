# Инструкция по развертыванию (Deployment)

Этот проект готов к развертыванию на хостингах, поддерживающих Node.js (например, Render, Railway, Heroku).

## Подготовка

Все необходимые файлы уже собраны в этой папке `deployment`.

## Вариант 1: Render.com (Бесплатно и просто)

1. Зарегистрируйтесь на [render.com](https://render.com).
2. Создайте новый **Web Service**.
3. Подключите ваш GitHub репозиторий (вам нужно будет сначала залить содержимое этой папки на GitHub).
4. Используйте следующие настройки:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
5. Нажмите **Create Web Service**.

## Вариант 2: Railway.app

1. Зарегистрируйтесь на [railway.app](https://railway.app).
2. Создайте новый проект -> Deploy from GitHub repo.
3. Railway автоматически определит Node.js проект и запустит его.

## Важно

В файле `server.js` используется API ключ:
`const COMET_API_KEY = 'sk-jwPgtUPNYyGb7YoirTUy26AKqmdFVzHLsHye55rV6OxIYDMK';`

⚠️ **Безопасность:** При публичном размещении кода на GitHub, рекомендуется вынести этот ключ в переменные окружения (Environment Variables) на хостинге, а в коде заменить на:
`const COMET_API_KEY = process.env.COMET_API_KEY;`

## Локальный запуск этой версии

1. Откройте терминал в этой папке.
2. Запустите:
   ```bash
   npm install
   npm start
   ```
3. Откройте браузер по адресу `http://localhost:3000`.
