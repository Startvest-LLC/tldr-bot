import { SlashCommandBuilder, EmbedBuilder, ChannelType } from 'discord.js';
import { getDb } from '../database.js';
import { checkUsageLimit, trackUsage } from '../services/usageTracker.js';
import OpenAI from 'openai';
import { config } from '../config.js';

const openai = new OpenAI({ apiKey: config.openai.apiKey });

export const command = {
    data: new SlashCommandBuilder()
        .setName('highlights')
        .setDescription('Get the most important moments from a channel')
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('Channel to get highlights from (defaults to current)')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('timeframe')
                .setDescription('How far back to look')
                .setRequired(false)
                .addChoices(
                    { name: 'Last 24 hours', value: '24h' },
                    { name: 'Last 3 days', value: '3d' },
                    { name: 'Last week', value: '7d' }
                )
        )
        .addIntegerOption(option =>
            option
                .setName('count')
                .setDescription('Number of highlights to show (default: 5)')
                .setMinValue(3)
                .setMaxValue(10)
                .setRequired(false)
        ),

    async execute(interaction) {
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const timeframe = interaction.options.getString('timeframe') || '24h';
        const count = interaction.options.getInteger('count') || 5;

        // Check usage limits
        const limitCheck = await checkUsageLimit(interaction.guild.id, interaction.user.id);
        if (!limitCheck.allowed) {
            return interaction.reply({
                content: `You've reached your daily limit. Upgrade to Pro for more!`,
                ephemeral: true,
            });
        }

        await interaction.deferReply();

        try {
            // Parse timeframe to hours
            const hours = parseTimeframe(timeframe);
            const since = new Date(Date.now() - hours * 3600000);

            // Fetch messages
            const messages = await fetchMessages(channel, since);

            if (messages.length < 5) {
                return interaction.editReply({
                    content: `Not enough messages in #${channel.name} in the last ${timeframe} to generate highlights.`,
                });
            }

            // Extract highlights using AI
            const highlights = await extractHighlights(messages, count);

            // Track usage
            await trackUsage(interaction.guild.id, interaction.user.id, 'highlights', highlights.tokensUsed);

            const embed = new EmbedBuilder()
                .setColor(0xFEE75C)
                .setTitle(`Highlights from #${channel.name}`)
                .setDescription(`Top ${highlights.items.length} moments from the last ${timeframe}`)
                .setFooter({ text: `TL;DR Bot • Based on ${messages.length} messages` })
                .setTimestamp();

            highlights.items.forEach((highlight, i) => {
                const emoji = getHighlightEmoji(highlight.type);
                embed.addFields({
                    name: `${emoji} ${highlight.title}`,
                    value: highlight.description,
                });
            });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Highlights error:', error);
            await interaction.editReply({
                content: 'Failed to extract highlights. Please try again later.',
            });
        }
    },
};

async function fetchMessages(channel, since) {
    const messages = [];
    let lastId;

    while (true) {
        const fetched = await channel.messages.fetch({
            limit: 100,
            ...(lastId && { before: lastId }),
        });

        if (fetched.size === 0) break;

        for (const msg of fetched.values()) {
            if (msg.createdAt < since) break;

            if (!msg.author.bot && msg.content) {
                messages.push({
                    id: msg.id,
                    author: msg.author.displayName || msg.author.username,
                    content: msg.content,
                    reactions: msg.reactions.cache.reduce((sum, r) => sum + r.count, 0),
                    createdAt: msg.createdAt,
                });
            }
        }

        lastId = fetched.last()?.id;
        if (fetched.size < 100 || messages.length >= 500) break;
    }

    return messages.sort((a, b) => a.createdAt - b.createdAt);
}

async function extractHighlights(messages, count) {
    const formattedMessages = messages.map(m =>
        `[${m.author}] (${m.reactions} reactions): ${m.content}`
    ).join('\n');

    const response = await openai.chat.completions.create({
        model: config.openai.model,
        messages: [
            {
                role: 'system',
                content: `You are an expert at identifying the most important, interesting, or noteworthy moments in Discord conversations.

Identify the top ${count} highlights based on:
- Important announcements or decisions
- Highly-reacted messages
- Key questions and answers
- Interesting discussions or debates
- Milestones or achievements mentioned
- Helpful resources shared

For each highlight, provide:
1. A short title (max 50 chars)
2. A brief description (1-2 sentences)
3. The type: announcement, discussion, question, resource, achievement, or funny

Format as JSON array:
[{"title": "...", "description": "...", "type": "..."}]`
            },
            {
                role: 'user',
                content: `Find the top ${count} highlights from this conversation:\n\n${formattedMessages}`
            }
        ],
        max_tokens: 1000,
        temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content || '[]';

    // Parse JSON from response
    let items = [];
    try {
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            items = JSON.parse(jsonMatch[0]);
        }
    } catch (e) {
        console.error('Failed to parse highlights JSON:', e);
        items = [{ title: 'Summary', description: content, type: 'discussion' }];
    }

    return {
        items: items.slice(0, count),
        tokensUsed: response.usage?.total_tokens || 0,
    };
}

function parseTimeframe(timeframe) {
    const match = timeframe.match(/^(\d+)(h|d|w)$/i);
    if (!match) return 24;
    const [, num, unit] = match;
    const multipliers = { h: 1, d: 24, w: 168 };
    return parseInt(num) * (multipliers[unit.toLowerCase()] || 1);
}

function getHighlightEmoji(type) {
    const emojis = {
        announcement: '📢',
        discussion: '💬',
        question: '❓',
        resource: '📚',
        achievement: '🏆',
        funny: '😂',
        default: '✨',
    };
    return emojis[type] || emojis.default;
}
