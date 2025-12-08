import { SlashCommandBuilder, EmbedBuilder, ChannelType } from 'discord.js';
import { getDb } from '../database.js';

export const command = {
    data: new SlashCommandBuilder()
        .setName('digest')
        .setDescription('Configure daily/weekly digest summaries')
        .addSubcommand(subcommand =>
            subcommand
                .setName('subscribe')
                .setDescription('Subscribe to digest summaries')
                .addStringOption(option =>
                    option
                        .setName('frequency')
                        .setDescription('How often to receive digests')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Daily', value: 'daily' },
                            { name: 'Weekly (Mondays)', value: 'weekly' }
                        )
                )
                .addStringOption(option =>
                    option
                        .setName('time')
                        .setDescription('Time to receive digest (HH:MM format, e.g., 09:00)')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('channels')
                .setDescription('Set which channels to include in your digest')
                .addChannelOption(option =>
                    option
                        .setName('channel1')
                        .setDescription('Channel to include')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
                .addChannelOption(option =>
                    option
                        .setName('channel2')
                        .setDescription('Channel to include')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false)
                )
                .addChannelOption(option =>
                    option
                        .setName('channel3')
                        .setDescription('Channel to include')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false)
                )
                .addChannelOption(option =>
                    option
                        .setName('channel4')
                        .setDescription('Channel to include')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false)
                )
                .addChannelOption(option =>
                    option
                        .setName('channel5')
                        .setDescription('Channel to include')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('unsubscribe')
                .setDescription('Stop receiving digest summaries')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Check your digest subscription status')
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const db = getDb();
        const guildId = interaction.guild.id;
        const userId = interaction.user.id;

        // Check if Pro tier (digests require Pro)
        const serverConfig = db.prepare(
            'SELECT tier FROM server_config WHERE guild_id = ?'
        ).get(guildId);

        const tier = serverConfig?.tier || 'free';
        if (tier === 'free' && subcommand !== 'status') {
            return interaction.reply({
                content: 'Digest subscriptions require **TL;DR Pro**. Upgrade at <https://tldrbot.com/pricing>',
                ephemeral: true,
            });
        }

        switch (subcommand) {
            case 'subscribe': {
                const frequency = interaction.options.getString('frequency');
                const time = interaction.options.getString('time') || '09:00';

                // Validate time format
                if (!/^\d{2}:\d{2}$/.test(time)) {
                    return interaction.reply({
                        content: 'Invalid time format. Please use HH:MM (e.g., 09:00)',
                        ephemeral: true,
                    });
                }

                db.prepare(`
                    INSERT INTO digest_subscriptions (guild_id, user_id, frequency, time, enabled)
                    VALUES (?, ?, ?, ?, 1)
                    ON CONFLICT(guild_id, user_id) DO UPDATE SET
                        frequency = excluded.frequency,
                        time = excluded.time,
                        enabled = 1
                `).run(guildId, userId, frequency, time);

                const embed = new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle('Digest Subscription Active')
                    .setDescription(`You'll receive ${frequency} digests at ${time} UTC.`)
                    .addFields({
                        name: 'Next Step',
                        value: 'Use `/digest channels` to select which channels to include.',
                    })
                    .setFooter({ text: 'TL;DR Bot' });

                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            case 'channels': {
                const channels = [];
                for (let i = 1; i <= 5; i++) {
                    const channel = interaction.options.getChannel(`channel${i}`);
                    if (channel) channels.push(channel.id);
                }

                db.prepare(`
                    UPDATE digest_subscriptions
                    SET channel_ids = ?
                    WHERE guild_id = ? AND user_id = ?
                `).run(JSON.stringify(channels), guildId, userId);

                const channelMentions = channels.map(id => `<#${id}>`).join(', ');

                const embed = new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle('Digest Channels Updated')
                    .setDescription(`Your digest will now include: ${channelMentions}`)
                    .setFooter({ text: 'TL;DR Bot' });

                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            case 'unsubscribe': {
                db.prepare(`
                    UPDATE digest_subscriptions
                    SET enabled = 0
                    WHERE guild_id = ? AND user_id = ?
                `).run(guildId, userId);

                return interaction.reply({
                    content: 'You have been unsubscribed from digest summaries.',
                    ephemeral: true,
                });
            }

            case 'status': {
                const subscription = db.prepare(`
                    SELECT frequency, time, channel_ids, enabled, last_sent
                    FROM digest_subscriptions
                    WHERE guild_id = ? AND user_id = ?
                `).get(guildId, userId);

                if (!subscription || !subscription.enabled) {
                    return interaction.reply({
                        content: 'You are not subscribed to any digests. Use `/digest subscribe` to start.',
                        ephemeral: true,
                    });
                }

                const channels = JSON.parse(subscription.channel_ids || '[]');
                const channelMentions = channels.length > 0
                    ? channels.map(id => `<#${id}>`).join(', ')
                    : 'No channels configured';

                const embed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle('Your Digest Subscription')
                    .addFields(
                        { name: 'Frequency', value: subscription.frequency, inline: true },
                        { name: 'Time (UTC)', value: subscription.time, inline: true },
                        { name: 'Channels', value: channelMentions },
                        {
                            name: 'Last Sent',
                            value: subscription.last_sent
                                ? new Date(subscription.last_sent).toLocaleDateString()
                                : 'Never',
                        }
                    )
                    .setFooter({ text: 'TL;DR Bot' });

                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
        }
    },
};
