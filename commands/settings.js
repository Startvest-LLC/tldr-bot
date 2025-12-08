import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getDb } from '../database.js';
import { getServerUsageStats } from '../services/usageTracker.js';

export const command = {
    data: new SlashCommandBuilder()
        .setName('tldr-settings')
        .setDescription('Manage TL;DR Bot settings for this server')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('View current settings and usage')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('upgrade')
                .setDescription('View upgrade options')
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const db = getDb();
        const guildId = interaction.guild.id;

        switch (subcommand) {
            case 'status': {
                // Get or create server config
                let serverConfig = db.prepare(
                    'SELECT * FROM server_config WHERE guild_id = ?'
                ).get(guildId);

                if (!serverConfig) {
                    db.prepare(`
                        INSERT INTO server_config (guild_id, guild_name, tier)
                        VALUES (?, ?, 'free')
                    `).run(guildId, interaction.guild.name);

                    serverConfig = { tier: 'free' };
                }

                // Get usage stats
                const stats = getServerUsageStats(guildId, 30);

                const tierEmoji = {
                    free: '🆓',
                    pro: '⭐',
                    enterprise: '🏢',
                };

                const embed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle('TL;DR Bot Settings')
                    .setDescription(`Server: **${interaction.guild.name}**`)
                    .addFields(
                        {
                            name: 'Current Plan',
                            value: `${tierEmoji[serverConfig.tier]} ${serverConfig.tier.charAt(0).toUpperCase() + serverConfig.tier.slice(1)}`,
                            inline: true,
                        },
                        {
                            name: 'Daily Limit',
                            value: serverConfig.tier === 'enterprise' ? 'Unlimited' : `${getTierLimit(serverConfig.tier)} summaries/day`,
                            inline: true,
                        },
                        {
                            name: 'Digests',
                            value: serverConfig.tier === 'free' ? 'Not available' : 'Enabled',
                            inline: true,
                        }
                    )
                    .addFields(
                        {
                            name: '📊 Usage (Last 30 Days)',
                            value: [
                                `• **${stats.totals.summaries}** summaries generated`,
                                `• **${stats.totals.uniqueUsers}** unique users`,
                                `• **${stats.totals.tokens.toLocaleString()}** AI tokens used`,
                            ].join('\n'),
                        }
                    )
                    .setFooter({ text: 'TL;DR Bot • tldrbot.com' })
                    .setTimestamp();

                // Add usage breakdown by command
                if (stats.byCommand.length > 0) {
                    const breakdown = stats.byCommand
                        .map(c => `\`/${c.command}\`: ${c.commandCount}`)
                        .join(' • ');
                    embed.addFields({ name: 'Command Usage', value: breakdown });
                }

                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            case 'upgrade': {
                const embed = new EmbedBuilder()
                    .setColor(0xFEE75C)
                    .setTitle('Upgrade TL;DR Bot')
                    .setDescription('Choose the plan that fits your community')
                    .addFields(
                        {
                            name: '🆓 Free',
                            value: [
                                '• 5 summaries per day',
                                '• 24 hour lookback',
                                '• Basic commands',
                                '• **$0/month**',
                            ].join('\n'),
                            inline: true,
                        },
                        {
                            name: '⭐ Pro',
                            value: [
                                '• 100 summaries per day',
                                '• 7 day lookback',
                                '• Digest subscriptions',
                                '• Priority support',
                                '• **$9/month**',
                            ].join('\n'),
                            inline: true,
                        },
                        {
                            name: '🏢 Enterprise',
                            value: [
                                '• Unlimited summaries',
                                '• 30 day lookback',
                                '• All features',
                                '• API access',
                                '• Custom branding',
                                '• **$29/month**',
                            ].join('\n'),
                            inline: true,
                        }
                    )
                    .addFields({
                        name: 'Ready to upgrade?',
                        value: 'Visit **[tldrbot.com/pricing](https://tldrbot.com/pricing)** to upgrade your server.',
                    })
                    .setFooter({ text: 'TL;DR Bot' });

                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
        }
    },
};

function getTierLimit(tier) {
    const limits = { free: 5, pro: 100, enterprise: '∞' };
    return limits[tier] || 5;
}
