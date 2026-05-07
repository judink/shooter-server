module.exports = {
  apps: [
    {
      name: "fih-shooter-leaderboard",
      script: "./server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "production",
        PORT: 4010,
        TELEGRAM_BOT_TOKEN: "",
        ALLOWED_ORIGINS: "https://fih-shooter.netlify.app",
        INIT_DATA_MAX_AGE_SECONDS: 86400,
      },
    },
  ],
};
