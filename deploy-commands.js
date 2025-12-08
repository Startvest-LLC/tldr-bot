import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const commands = [];
const commandsPath = join(__dirname, 'commands');
const commandFiles = readdirSync(commandsPath).filter(file => file.endsWith('.js'));

console.log('Loading commands for deployment...');

for (const file of commandFiles) {
    const filePath = join(commandsPath, file);
    const { command } = await import(`file://${filePath}`);

    if ('data' in command) {
        commands.push(command.data.toJSON());
        console.log(`  ✓ /${command.data.name}`);
    }
}

const rest = new REST().setToken(config.discord.token);

(async () => {
    try {
        console.log(`\nDeploying ${commands.length} commands...`);

        // Deploy globally
        const data = await rest.put(
            Routes.applicationCommands(config.discord.clientId),
            { body: commands },
        );

        console.log(`✅ Successfully deployed ${data.length} commands globally!`);
        console.log('\nNote: Global commands may take up to 1 hour to propagate.');

    } catch (error) {
        console.error('Error deploying commands:', error);
    }
})();
