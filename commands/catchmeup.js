import { SlashCommandBuilder, ChannelType, EmbedBuilder } from 'discord.js';
import { summarizeChannel } from '../services/summarizer.js';
import { checkUsageLimit, trackUsage } from '../services/usageTracker.js';

export const command = {
    data: new SlashCommandBuilder()
        .setName('catchmeup')
        .setDescription('Get a summary of what you missed in a channel')
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('Channel to summarize (defaults to current)')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('timeframe')
                .setDescription('How far back to look')
                .setRequired(false)
                .addChoices(
                    { name: 'Last 6 hours', value: '6h' },
                    { name: 'Last 12 hours', value: '12h' },
                    { name: 'Last 24 hours', value: '24h' },
                    { name: 'Last 2 days', value: '2d' },
                    { name: 'Last 3 days', value: '3d' },
                    { name: 'Last week', value: '7d' }
                )
        )
        .addStringOption(option =>
            option
                .setName('style')
                .setDescription('Summary style')
                .setRequired(false)
                .addChoices(
                    { name: 'Concise (2-3 sentences)', value: 'concise' },
                    { name: 'Detailed', value: 'detailed' },
                    { name: 'Bullet points', value: 'bullet' }
                )
        ),

    async execute(interaction) {
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const timeframe = interaction.options.getString('timeframe') || '24h';
        const style = interaction.options.getString('style') || 'concise';

        // Check usage limits
        const limitCheck = await checkUsageLimit(interaction.guild.id, interaction.user.id);
        if (!limitCheck.allowed) {
            return interaction.reply({
                content: `You've reached your daily limit of ${limitCheck.limit} summaries. Upgrade to Pro for more!`,
                ephemeral: true,
            });
        }

        await interaction.deferReply();

        try {
            const result = await summarizeChannel(channel, timeframe, { style });

            // Track usage
            await trackUsage(interaction.guild.id, interaction.user.id, 'catchmeup', result.tokensUsed);

            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle(`TL;DR for #${channel.name}`)
                .setDescription(result.summary)
                .addFields(
                    { name: 'Messages', value: `${result.messageCount}`, inline: true },
                    { name: 'Timeframe', value: timeframe, inline: true }
                )
                .setFooter({ text: `TL;DR Bot • ${limitCheck.remaining} summaries remaining today` })
                .setTimestamp();

            // Add highlights if present
            if (result.highlights && result.highlights.length > 0) {
                embed.addFields({
                    name: 'Key Moments',
                    value: result.highlights.map((h, i) => `${i + 1}. ${h}`).join('\n'),
                });
            }

            if (result.cached) {
                embed.setFooter({ text: 'TL;DR Bot • Cached summary (< 1 hour old)' });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Catchmeup error:', error);
            await interaction.editReply({
                content: 'Failed to generate summary. Please try again later.',
            });
        }
    },
};
