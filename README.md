# Fih Shooter Leaderboard Server

Simple Express leaderboard server for Telegram Mini App score submission.

## Features

- Verifies Telegram `initData` on the server
- Stores scores in a JSON file
- Exposes:
  - `GET /health`
  - `GET /api/leaderboard`
  - `POST /api/leaderboard/submit`
- Works well with `pm2`

## 1. Install

```bash
cd ~/fih-shooter/leaderboard-server
npm install
```

## 2. Configure

Copy `.env.example` values into your shell or PM2 config.

Required values:

- `TELEGRAM_BOT_TOKEN`
- `ALLOWED_ORIGINS`

Example origin:

`https://fih-shooter.netlify.app`

## 3. Run with PM2

Edit `ecosystem.config.cjs` and set your real bot token first.

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 status
```

## 4. Test

```bash
curl http://127.0.0.1:4010/health
curl "http://127.0.0.1:4010/api/leaderboard?limit=10"
```

## 5. HTTPS

Because your Netlify game runs over `https`, the leaderboard API should also be exposed over `https`.

Typical production setup:

- Node server listens on `127.0.0.1:4010`
- Nginx reverse proxy exposes `https://your-api-domain`

Example frontend config:

```js
window.FIH_SHOOTER_CONFIG = {
  apiBaseUrl: "https://your-api-domain",
  leaderboardLimit: 10,
};
```

Put that into the root `config.js` file of the web project and redeploy Netlify.
