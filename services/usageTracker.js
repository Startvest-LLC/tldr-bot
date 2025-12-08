import { getDb } from '../database.js';
import { config } from '../config.js';

/**
 * Check if a user can use a summary command (within limits)
 */
export async function checkUsageLimit(guildId, userId) {
    const db = getDb();

    // Get server tier
    const serverConfig = db.prepare(
        'SELECT tier FROM server_config WHERE guild_id = ?'
    ).get(guildId);

    const tier = serverConfig?.tier || 'free';
    const limits = config.limits[tier] || config.limits.free;

    // Count today's usage
    const today = new Date().toISOString().split('T')[0];
    const usage = db.prepare(`
        SELECT COUNT(*) as count
        FROM usage_tracking
        WHERE guild_id = ? AND user_id = ?
        AND date(created_at) = ?
    `).get(guildId, userId, today);

    const usedToday = usage?.count || 0;
    const remaining = Math.max(0, limits.summariesPerDay - usedToday);

    return {
        allowed: usedToday < limits.summariesPerDay,
        used: usedToday,
        limit: limits.summariesPerDay,
        remaining,
        tier,
    };
}

/**
 * Track a usage event
 */
export async function trackUsage(guildId, userId, command, tokensUsed = 0) {
    const db = getDb();

    db.prepare(`
        INSERT INTO usage_tracking (guild_id, user_id, command, tokens_used)
        VALUES (?, ?, ?, ?)
    `).run(guildId, userId, command, tokensUsed);
}

/**
 * Get usage stats for a server
 */
export function getServerUsageStats(guildId, days = 30) {
    const db = getDb();
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const stats = db.prepare(`
        SELECT
            COUNT(*) as totalSummaries,
            COUNT(DISTINCT user_id) as uniqueUsers,
            SUM(tokens_used) as totalTokens,
            command,
            COUNT(*) as commandCount
        FROM usage_tracking
        WHERE guild_id = ? AND created_at >= ?
        GROUP BY command
    `).all(guildId, since);

    const daily = db.prepare(`
        SELECT
            date(created_at) as date,
            COUNT(*) as count
        FROM usage_tracking
        WHERE guild_id = ? AND created_at >= ?
        GROUP BY date(created_at)
        ORDER BY date ASC
    `).all(guildId, since);

    return {
        byCommand: stats,
        daily,
        totals: {
            summaries: stats.reduce((sum, s) => sum + s.commandCount, 0),
            tokens: stats.reduce((sum, s) => sum + (s.totalTokens || 0), 0),
            uniqueUsers: new Set(stats.map(s => s.uniqueUsers)).size,
        },
    };
}

/**
 * Check if server has access to a feature
 */
export function hasFeatureAccess(guildId, feature) {
    const db = getDb();

    const serverConfig = db.prepare(
        'SELECT tier FROM server_config WHERE guild_id = ?'
    ).get(guildId);

    const tier = serverConfig?.tier || 'free';
    const limits = config.limits[tier];

    switch (feature) {
        case 'digest':
            return limits.digestsEnabled;
        case 'extended_timeframe':
            return tier !== 'free';
        case 'unlimited':
            return tier === 'enterprise';
        default:
            return true;
    }
}
