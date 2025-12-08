import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { summarizeThread, summarizeMessages } from '../services/summarizer.js';
import { checkUsageLimit, trackUsage } from '../services/usageTracker.js';

export const command = {
    data: new SlashCommandBuilder()
        .setName('tldr')
        .setDescription('Summarize the current thread or recent conversation')
        .addIntegerOption(option =>
            option
                .setName('messages')
                .setDescription('Number of recent messages to summarize (default: 50)')
                .setMinValue(10)
                .setMaxValue(200)
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('style')
                .setDescription('Summary style')
                .setRequired(false)
                .addChoices(
                    { name: 'Concise', value: 'concise' },
                    { name: 'Detailed', value: 'detailed' },
                    { name: 'Bullet points', value: 'bullet' }
                )
        ),

    async execute(interaction) {
        const messageCount = interaction.options.getInteger('messages') || 50;
        const style = interaction.options.getString('style') || 'concise';

        // Check usage limits
        const limitCheck = await checkUsageLimit(interaction.guild.id, interaction.user.id);
        if (!limitCheck.allowed) {
            return interaction.reply({
                content: `You've reached your daily limit. Upgrade to Pro for more summaries!`,
                ephemeral: true,
            });
        }

        await interaction.deferReply();

        try {
            let result;
            let title;

            // Check if we're in a thread
            if (interaction.channel.isThread()) {
                result = await summarizeThread(interaction.channel, { style });
                title = `TL;DR: ${interaction.channel.name}`;
            } else {
                // Summarize recent messages in the channel
                const messages = [];
                let lastId;

                const fetched = await interaction.channel.messages.fetch({ limit: messageCount });
                fetched.forEach(msg => {
                    if (!msg.author.bot && msg.content) {
                        messages.push({
                            author_name: msg.author.displayName || msg.author.username,
                            content: msg.content,
                            created_at: msg.createdAt,
                        });
                    }
                });

                // Sort chronologically
                messages.sort((a, b) => a.created_at - b.created_at);

                result = await summarizeMessages(messages, { style });
                title = `TL;DR: Last ${messages.length} messages`;
            }

            // Track usage
            await trackUsage(interaction.guild.id, interaction.user.id, 'tldr', result.tokensUsed);

            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle(title)
                .setDescription(result.summary)
                .addFields(
                    { name: 'Messages Analyzed', value: `${result.messageCount}`, inline: true }
                )
                .setFooter({ text: `TL;DR Bot • ${limitCheck.remaining} summaries remaining today` })
                .setTimestamp();

            if (result.highlights && result.highlights.length > 0) {
                embed.addFields({
                    name: 'Key Points',
                    value: result.highlights.map((h, i) => `• ${h}`).join('\n'),
                });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('TLDR error:', error);
            await interaction.editReply({
                content: 'Failed to generate summary. Please try again later.',
            });
        }
    },
};
