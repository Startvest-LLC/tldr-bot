import 'dotenv/config';

export const config = {
    discord: {
        token: process.env.DISCORD_TOKEN,
        clientId: process.env.DISCORD_CLIENT_ID,
    },
    openai: {
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.SUMMARY_MODEL || 'gpt-4o-mini',
    },
    settings: {
        maxMessagesToFetch: parseInt(process.env.MAX_MESSAGES_TO_FETCH) || 500,
        maxSummaryMessages: 200, // Max messages to include in a single summary
        cacheRetentionDays: 7, // How long to keep cached messages
    },
    limits: {
        free: {
            summariesPerDay: 5,
            maxTimeframe: '24h',
            digestsEnabled: false,
        },
        pro: {
            summariesPerDay: 100,
            maxTimeframe: '7d',
            digestsEnabled: true,
        },
        enterprise: {
            summariesPerDay: Infinity,
            maxTimeframe: '30d',
            digestsEnabled: true,
        },
    },
};

export function validateConfig() {
    const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'OPENAI_API_KEY'];
    const missing = required.filter(key => !process.env[key]);

    if (missing.length > 0) {
        console.error('Missing required environment variables:', missing.join(', '));
        process.exit(1);
    }
}
