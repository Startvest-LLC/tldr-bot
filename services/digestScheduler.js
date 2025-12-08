import cron from 'node-cron';
import { getDb } from '../database.js';
import { getCatchupSummary } from './summarizer.js';
import { EmbedBuilder } from 'discord.js';

let client = null;
const scheduledJobs = new Map();

/**
 * Initialize the digest scheduler
 */
export function initDigestScheduler(discordClient) {
    client = discordClient;

    // Run every hour to check for digests to send
    cron.schedule('0 * * * *', async () => {
        await processDigests();
    });

    console.log('Digest scheduler initialized');
}

/**
 * Process all due digests
 */
async function processDigests() {
    const db = getDb();
    const now = new Date();
    const currentHour = now.getUTCHours().toString().padStart(2, '0');
    const currentMinute = '00'; // We run on the hour
    const currentTime = `${currentHour}:${currentMinute}`;

    // Get daily digests due now
    const dailyDigests = db.prepare(`
        SELECT ds.*, sc.tier
        FROM digest_subscriptions ds
        JOIN server_config sc ON ds.guild_id = sc.guild_id
        WHERE ds.enabled = 1
        AND ds.frequency = 'daily'
        AND ds.time = ?
        AND (ds.last_sent IS NULL OR date(ds.last_sent) < date('now'))
    `).all(currentTime);

    // Get weekly digests (Mondays)
    const dayOfWeek = now.getUTCDay();
    const weeklyDigests = dayOfWeek === 1 ? db.prepare(`
        SELECT ds.*, sc.tier
        FROM digest_subscriptions ds
        JOIN server_config sc ON ds.guild_id = sc.guild_id
        WHERE ds.enabled = 1
        AND ds.frequency = 'weekly'
        AND ds.time = ?
        AND (ds.last_sent IS NULL OR date(ds.last_sent) < date('now', '-6 days'))
    `).all(currentTime) : [];

    const allDigests = [...dailyDigests, ...weeklyDigests];

    for (const digest of allDigests) {
        try {
            await sendDigest(digest);

            // Update last_sent
            db.prepare(`
                UPDATE digest_subscriptions
                SET last_sent = datetime('now')
                WHERE id = ?
            `).run(digest.id);

        } catch (error) {
            console.error(`Failed to send digest ${digest.id}:`, error);
        }
    }

    if (allDigests.length > 0) {
        console.log(`Processed ${allDigests.length} digests`);
    }
}

/**
 * Send a digest to a user
 */
async function sendDigest(subscription) {
    const { guild_id, user_id, channel_ids, frequency } = subscription;

    // Get the guild
    const guild = client.guilds.cache.get(guild_id);
    if (!guild) {
        console.log(`Guild ${guild_id} not found, skipping digest`);
        return;
    }

    // Get the user
    let user;
    try {
        user = await client.users.fetch(user_id);
    } catch (error) {
        console.log(`User ${user_id} not found, skipping digest`);
        return;
    }

    // Parse channel IDs
    const channels = JSON.parse(channel_ids || '[]');
    if (channels.length === 0) {
        return; // No channels configured
    }

    // Determine timeframe based on frequency
    const timeframe = frequency === 'weekly' ? '7d' : '24h';
    const periodLabel = frequency === 'weekly' ? 'This Week' : 'Today';

    // Get summaries for each channel
    const summaries = await getCatchupSummary(guild, user_id, channels, timeframe);

    if (summaries.length === 0 || summaries.every(s => s.messageCount === 0)) {
        // No activity, skip sending
        return;
    }

    // Build the digest embed
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`Your ${frequency === 'weekly' ? 'Weekly' : 'Daily'} Digest for ${guild.name}`)
        .setDescription(`Here's what happened ${periodLabel.toLowerCase()} in the channels you follow.`)
        .setTimestamp()
        .setFooter({ text: 'TL;DR Bot • Manage with /digest' });

    let totalMessages = 0;
    for (const summary of summaries) {
        if (summary.messageCount === 0) continue;

        totalMessages += summary.messageCount;

        let fieldValue = summary.summary;
        if (fieldValue.length > 1000) {
            fieldValue = fieldValue.substring(0, 997) + '...';
        }

        embed.addFields({
            name: `#${summary.channel} (${summary.messageCount} messages)`,
            value: fieldValue,
        });
    }

    embed.addFields({
        name: 'Stats',
        value: `${totalMessages} messages across ${summaries.length} channels`,
        inline: true,
    });

    // Send DM to user
    try {
        await user.send({ embeds: [embed] });
        console.log(`Sent ${frequency} digest to ${user.tag} for ${guild.name}`);
    } catch (error) {
        console.error(`Failed to DM user ${user.tag}:`, error.message);
    }
}

/**
 * Send a test digest immediately
 */
export async function sendTestDigest(guildId, userId) {
    const db = getDb();

    const subscription = db.prepare(`
        SELECT * FROM digest_subscriptions
        WHERE guild_id = ? AND user_id = ?
    `).get(guildId, userId);

    if (!subscription) {
        throw new Error('No subscription found');
    }

    await sendDigest(subscription);
    return true;
}
