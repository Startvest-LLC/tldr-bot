import { Client, Collection, GatewayIntentBits, Events } from 'discord.js';
import { config, validateConfig } from './config.js';
import { initDatabase, closeDatabase, cleanupOldCache } from './database.js';
import { initDigestScheduler } from './services/digestScheduler.js';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';

// Health check server for Azure App Service
const healthPort = process.env.PORT || 8080;
const healthServer = createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'healthy', service: 'tldrbot' }));
    } else {
        res.writeHead(404);
        res.end();
    }
});
healthServer.listen(healthPort, () => {
    console.log(`Health check server listening on port ${healthPort}`);
});

const __dirname = dirname(fileURLToPath(import.meta.url));

// ASCII art banner
console.log(`
╔═══════════════════════════════════════════════╗
║                                               ║
║   📝 TL;DR Bot - Never Miss What Happened     ║
║                                               ║
║   AI-powered conversation summaries           ║
║   Catch up on any channel instantly           ║
║   Scheduled digests & highlights              ║
║                                               ║
╚═══════════════════════════════════════════════╝
`);

// Validate configuration
console.log('Validating configuration...');
validateConfig();
console.log('✓ Configuration valid\n');

// Initialize database
console.log('Initializing database...');
const db = initDatabase();
console.log('✓ Database ready\n');

// Create Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// Load commands
client.commands = new Collection();
const commandsPath = join(__dirname, 'commands');
const commandFiles = readdirSync(commandsPath).filter(file => file.endsWith('.js'));

console.log('Loading commands...');
for (const file of commandFiles) {
    const filePath = join(commandsPath, file);
    const { command } = await import(`file://${filePath}`);

    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        console.log(`  ✓ /${command.data.name}`);
    }
}
console.log(`✓ Loaded ${client.commands.size} commands\n`);

// Handle slash commands
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) {
        console.error(`Command not found: ${interaction.commandName}`);
        return;
    }

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(`Error executing ${interaction.commandName}:`, error);

        const errorMessage = {
            content: 'There was an error executing this command.',
            ephemeral: true
        };

        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorMessage);
        } else {
            await interaction.reply(errorMessage);
        }
    }
});

// Ready event
client.once(Events.ClientReady, async readyClient => {
    console.log('═'.repeat(50));
    console.log(`✅ TL;DR Bot is online!`);
    console.log(`   Logged in as: ${readyClient.user.tag}`);
    console.log(`   Serving ${readyClient.guilds.cache.size} server(s)`);
    console.log('═'.repeat(50));

    // Initialize digest scheduler
    initDigestScheduler(client);
    console.log('✓ Digest scheduler initialized');

    // Schedule daily cache cleanup
    setInterval(() => {
        cleanupOldCache(7);
    }, 24 * 60 * 60 * 1000); // Run every 24 hours

    console.log('\n📝 Ready to summarize conversations!');
    console.log('Commands: /catchmeup, /tldr, /highlights, /digest\n');
});

// Guild join - welcome message
client.on(Events.GuildCreate, async guild => {
    console.log(`[Guild] Joined: ${guild.name} (${guild.id})`);

    // Create default config
    const db = initDatabase();
    db.prepare(`
        INSERT OR IGNORE INTO server_config (guild_id, guild_name, tier)
        VALUES (?, ?, 'free')
    `).run(guild.id, guild.name);
});

// Guild leave
client.on(Events.GuildDelete, async guild => {
    console.log(`[Guild] Left: ${guild.name} (${guild.id})`);
});

// Error handling
client.on(Events.Error, error => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

// Graceful shutdown
async function shutdown(signal) {
    console.log(`\n\n${signal} received. Shutting down gracefully...`);

    healthServer.close();
    closeDatabase();
    client.destroy();

    console.log('Shutdown complete.');
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Login
console.log('Connecting to Discord...\n');
client.login(config.discord.token);
