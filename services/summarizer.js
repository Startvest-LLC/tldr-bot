import OpenAI from 'openai';
import { config } from '../config.js';
import { getDb } from '../database.js';

const openai = new OpenAI({ apiKey: config.openai.apiKey });

/**
 * Summarize a list of messages using AI
 */
export async function summarizeMessages(messages, options = {}) {
    const {
        style = 'concise', // 'concise', 'detailed', 'bullet'
        includeHighlights = true,
        maxLength = 500,
    } = options;

    if (!messages || messages.length === 0) {
        return { summary: 'No messages to summarize.', highlights: [] };
    }

    // Format messages for the AI
    const formattedMessages = messages.map(m =>
        `[${m.author_name}]: ${m.content}`
    ).join('\n');

    const styleInstructions = {
        concise: 'Provide a brief 2-3 sentence summary.',
        detailed: 'Provide a comprehensive summary covering all main topics discussed.',
        bullet: 'Provide a bullet-point summary of the key points.',
    };

    const systemPrompt = `You are a Discord conversation summarizer. Your job is to create clear, helpful summaries that help people catch up on what they missed.

Rules:
- Be concise and focus on substance
- Mention key participants when relevant
- Highlight any decisions made, questions asked, or important announcements
- Use present tense for ongoing topics
- Don't include every detail - focus on what matters
- If there are links or resources mentioned, note them
- ${styleInstructions[style] || styleInstructions.concise}`;

    const userPrompt = `Summarize this Discord conversation:\n\n${formattedMessages}${
        includeHighlights ? '\n\nAlso identify 1-3 highlights or key moments worth noting separately.' : ''
    }`;

    try {
        const response = await openai.chat.completions.create({
            model: config.openai.model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            max_tokens: maxLength * 2,
            temperature: 0.3,
        });

        const content = response.data?.choices?.[0]?.message?.content
            || response.choices?.[0]?.message?.content
            || 'Unable to generate summary.';

        // Parse highlights if present
        let summary = content;
        let highlights = [];

        if (includeHighlights && content.includes('Highlight')) {
            const parts = content.split(/(?:Highlights?:|Key moments?:)/i);
            summary = parts[0].trim();
            if (parts[1]) {
                highlights = parts[1]
                    .split(/[-•\d.]\s*/)
                    .filter(h => h.trim().length > 0)
                    .map(h => h.trim())
                    .slice(0, 3);
            }
        }

        return {
            summary,
            highlights,
            messageCount: messages.length,
            tokensUsed: response.usage?.total_tokens || 0,
        };
    } catch (error) {
        console.error('Summarization error:', error);
        throw new Error('Failed to generate summary. Please try again.');
    }
}

/**
 * Summarize a specific channel over a time period
 */
export async function summarizeChannel(channel, timeframe = '24h', options = {}) {
    const db = getDb();
    const guildId = channel.guild.id;
    const channelId = channel.id;

    // Parse timeframe
    const hours = parseTimeframe(timeframe);
    const since = new Date(Date.now() - hours * 3600000);

    // Check cache first
    const cached = db.prepare(`
        SELECT summary, highlights_json, message_count
        FROM summary_history
        WHERE guild_id = ? AND channel_id = ?
        AND start_time >= ? AND end_time <= ?
        AND created_at > datetime('now', '-1 hour')
    `).get(guildId, channelId, since.toISOString(), new Date().toISOString());

    if (cached && !options.force) {
        return {
            summary: cached.summary,
            highlights: JSON.parse(cached.highlights_json || '[]'),
            messageCount: cached.message_count,
            cached: true,
        };
    }

    // Fetch messages from Discord
    const messages = await fetchChannelMessages(channel, since);

    if (messages.length === 0) {
        return {
            summary: `No messages in #${channel.name} in the last ${timeframe}.`,
            highlights: [],
            messageCount: 0,
        };
    }

    // Generate summary
    const result = await summarizeMessages(messages, options);

    // Cache the result
    db.prepare(`
        INSERT INTO summary_history (guild_id, channel_id, start_time, end_time, message_count, summary, highlights_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        guildId,
        channelId,
        since.toISOString(),
        new Date().toISOString(),
        result.messageCount,
        result.summary,
        JSON.stringify(result.highlights)
    );

    return result;
}

/**
 * Summarize a thread
 */
export async function summarizeThread(thread, options = {}) {
    const messages = [];
    let lastId;

    // Fetch all messages from thread
    while (true) {
        const fetched = await thread.messages.fetch({
            limit: 100,
            ...(lastId && { before: lastId }),
        });

        if (fetched.size === 0) break;

        fetched.forEach(msg => {
            if (!msg.author.bot && msg.content) {
                messages.push({
                    author_name: msg.author.displayName || msg.author.username,
                    content: msg.content,
                    created_at: msg.createdAt,
                });
            }
        });

        lastId = fetched.last()?.id;
        if (fetched.size < 100) break;
    }

    // Sort chronologically
    messages.sort((a, b) => a.created_at - b.created_at);

    return summarizeMessages(messages, options);
}

/**
 * Fetch messages from a channel since a given time
 */
async function fetchChannelMessages(channel, since) {
    const messages = [];
    let lastId;
    let reachedLimit = false;

    while (!reachedLimit) {
        const fetched = await channel.messages.fetch({
            limit: 100,
            ...(lastId && { before: lastId }),
        });

        if (fetched.size === 0) break;

        for (const msg of fetched.values()) {
            if (msg.createdAt < since) {
                reachedLimit = true;
                break;
            }

            if (!msg.author.bot && msg.content) {
                messages.push({
                    author_name: msg.author.displayName || msg.author.username,
                    content: msg.content,
                    created_at: msg.createdAt,
                });
            }
        }

        lastId = fetched.last()?.id;
        if (fetched.size < 100) break;
        if (messages.length >= config.settings.maxMessagesToFetch) break;
    }

    // Sort chronologically (oldest first)
    messages.sort((a, b) => a.created_at - b.created_at);

    // Limit to max summary messages
    if (messages.length > config.settings.maxSummaryMessages) {
        return messages.slice(-config.settings.maxSummaryMessages);
    }

    return messages;
}

/**
 * Parse timeframe string to hours
 */
function parseTimeframe(timeframe) {
    const match = timeframe.match(/^(\d+)(h|d|w)$/i);
    if (!match) return 24; // Default 24 hours

    const [, num, unit] = match;
    const multipliers = { h: 1, d: 24, w: 168 };
    return parseInt(num) * (multipliers[unit.toLowerCase()] || 1);
}

/**
 * Get catchup summary for a user (multiple channels)
 */
export async function getCatchupSummary(guild, userId, channelIds = [], since = null) {
    const summaries = [];
    const defaultSince = new Date(Date.now() - 24 * 3600000); // 24h default

    for (const channelId of channelIds) {
        const channel = guild.channels.cache.get(channelId);
        if (!channel || !channel.isTextBased()) continue;

        try {
            const result = await summarizeChannel(channel, since || '24h');
            if (result.messageCount > 0) {
                summaries.push({
                    channel: channel.name,
                    channelId: channel.id,
                    ...result,
                });
            }
        } catch (error) {
            console.error(`Error summarizing ${channel.name}:`, error);
        }
    }

    return summaries;
}
