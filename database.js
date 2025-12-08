import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, 'data');

// Ensure data directory exists
if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
}

const dbPath = join(dataDir, 'tldr.db');
let db = null;

export function initDatabase() {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');

    // Server configuration
    db.exec(`
        CREATE TABLE IF NOT EXISTS server_config (
            guild_id TEXT PRIMARY KEY,
            guild_name TEXT,
            tier TEXT DEFAULT 'free',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            settings_json TEXT
        )
    `);

    // Message cache for summarization
    db.exec(`
        CREATE TABLE IF NOT EXISTS message_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            message_id TEXT UNIQUE NOT NULL,
            author_id TEXT NOT NULL,
            author_name TEXT NOT NULL,
            content TEXT,
            created_at DATETIME NOT NULL,
            cached_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_cache_guild_channel ON message_cache(guild_id, channel_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_cache_created ON message_cache(created_at)`);

    // Usage tracking
    db.exec(`
        CREATE TABLE IF NOT EXISTS usage_tracking (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            command TEXT NOT NULL,
            tokens_used INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_usage_guild_date ON usage_tracking(guild_id, created_at)`);

    // Digest subscriptions
    db.exec(`
        CREATE TABLE IF NOT EXISTS digest_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            channel_ids TEXT, -- JSON array of channel IDs
            frequency TEXT DEFAULT 'daily', -- 'daily', 'weekly'
            time TEXT DEFAULT '09:00', -- HH:MM format
            timezone TEXT DEFAULT 'UTC',
            enabled INTEGER DEFAULT 1,
            last_sent DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(guild_id, user_id)
        )
    `);

    // Summary history (for caching/avoiding re-summarizing)
    db.exec(`
        CREATE TABLE IF NOT EXISTS summary_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            start_time DATETIME NOT NULL,
            end_time DATETIME NOT NULL,
            message_count INTEGER,
            summary TEXT,
            highlights_json TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_summary_lookup ON summary_history(guild_id, channel_id, start_time, end_time)`);

    console.log('Database initialized at:', dbPath);
    return db;
}

export function getDb() {
    if (!db) {
        throw new Error('Database not initialized. Call initDatabase() first.');
    }
    return db;
}

export function closeDatabase() {
    if (db) {
        db.close();
        console.log('Database connection closed.');
    }
}

// Cleanup old cached messages
export function cleanupOldCache(daysOld = 7) {
    const db = getDb();
    const cutoff = new Date(Date.now() - daysOld * 86400000).toISOString();

    const result = db.prepare('DELETE FROM message_cache WHERE cached_at < ?').run(cutoff);
    console.log(`Cleaned up ${result.changes} old cached messages`);
    return result.changes;
}
