import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 4010);
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const MAX_LEADERBOARD_LIMIT = 50;
const DEFAULT_LEADERBOARD_LIMIT = 10;
const INIT_DATA_MAX_AGE_SECONDS = Number(process.env.INIT_DATA_MAX_AGE_SECONDS || 86400);
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "leaderboard.json");

const app = express();

app.use(express.json({ limit: "64kb" }));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed by CORS"));
    },
  }),
);

function clampLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_LEADERBOARD_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LEADERBOARD_LIMIT, Math.floor(parsed)));
}

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify({ entries: [] }, null, 2), "utf8");
  }
}

async function readStore() {
  await ensureDataFile();
  const raw = await fs.readFile(DATA_FILE, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.entries)) {
    return { entries: [] };
  }
  return parsed;
}

async function writeStore(store) {
  await ensureDataFile();
  const tempPath = `${DATA_FILE}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(tempPath, DATA_FILE);
}

function buildDataCheckString(params) {
  return [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function validateTelegramInitData(initData) {
  if (!BOT_TOKEN) {
    throw new Error("Server is missing TELEGRAM_BOT_TOKEN");
  }
  if (!initData || typeof initData !== "string") {
    throw new Error("initData is required");
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) {
    throw new Error("initData hash is missing");
  }

  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate) {
    throw new Error("auth_date is missing");
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (ageSeconds > INIT_DATA_MAX_AGE_SECONDS) {
    throw new Error("initData is too old");
  }

  const dataCheckString = buildDataCheckString(params);
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const computedHash = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");

  if (computedHash !== hash) {
    throw new Error("initData hash is invalid");
  }

  const userRaw = params.get("user");
  if (!userRaw) {
    throw new Error("Telegram user is missing");
  }

  const user = JSON.parse(userRaw);
  if (!user || typeof user.id !== "number") {
    throw new Error("Telegram user payload is invalid");
  }

  return user;
}

function createDisplayName(user) {
  if (user.username) {
    return `@${user.username}`;
  }
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  if (fullName) {
    return fullName;
  }
  return `user_${user.id}`;
}

function sanitizeScore(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("score must be a number");
  }
  return Math.max(0, Math.floor(parsed));
}

function sanitizeWave(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.max(1, Math.floor(parsed));
}

function toLeaderboardEntry(entry) {
  return {
    id: entry.id,
    telegramUserId: entry.telegramUserId,
    username: entry.username || "",
    displayName: entry.displayName,
    score: entry.score,
    wave: entry.wave,
    createdAt: entry.createdAt,
  };
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

function buildPlayerSummary(entries, telegramUserId) {
  if (!telegramUserId) {
    return null;
  }

  const userId = Number(telegramUserId);
  if (!Number.isFinite(userId)) {
    return null;
  }

  const sorted = sortEntries(entries);
  const userEntries = sorted
    .map((entry, index) => ({ ...entry, rank: index + 1 }))
    .filter((entry) => entry.telegramUserId === userId);

  if (!userEntries.length) {
    return {
      telegramUserId: userId,
      currentRank: null,
      bestRank: null,
    };
  }

  const latestEntry = [...userEntries].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0];
  const bestRank = userEntries.reduce((best, entry) => Math.min(best, entry.rank), Number.POSITIVE_INFINITY);

  return {
    telegramUserId: userId,
    currentRank: latestEntry.rank,
    bestRank: Number.isFinite(bestRank) ? bestRank : null,
  };
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "fih-shooter-leaderboard" });
});

app.get("/api/leaderboard", async (req, res) => {
  try {
    const limit = clampLimit(req.query.limit);
    const store = await readStore();
    const sorted = sortEntries(store.entries);
    const entries = sorted
      .slice(0, limit)
      .map(toLeaderboardEntry);
    const playerSummary = buildPlayerSummary(store.entries, req.query.telegramUserId);

    res.json({ entries, total: store.entries.length, playerSummary });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to load leaderboard" });
  }
});

app.post("/api/leaderboard/submit", async (req, res) => {
  try {
    const score = sanitizeScore(req.body?.score);
    const wave = sanitizeWave(req.body?.wave);
    const initData = req.body?.initData;
    const user = validateTelegramInitData(initData);

    const entry = {
      id: crypto.randomUUID(),
      telegramUserId: user.id,
      username: user.username || "",
      displayName: createDisplayName(user),
      score,
      wave,
      createdAt: new Date().toISOString(),
    };

    const store = await readStore();
    store.entries.push(entry);
    store.entries = sortEntries(store.entries);
    store.entries = store.entries.slice(0, 5000);
    await writeStore(store);

    res.status(201).json({ ok: true, entry: toLeaderboardEntry(entry) });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message || "Failed to submit score" });
  }
});

ensureDataFile()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Leaderboard server listening on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start leaderboard server", error);
    process.exit(1);
  });
