import * as fsPromises from 'fs/promises';
import logger from './Logger';

export interface ConfigInterface {
    environment: string;
    discord: DiscordConfigInterface;
    availableLinkTypes: string[];
    mqtt: MqttConfigInterface;
    redis: RedisConfigInterface;
    db: DBConfigInterface;
    version: string;
}

export interface DBConfigInterface {
    path: string;
}

export interface DiscordConfigInterface {
    token: string;
    nickname: string;
    clientId: string;
    guilds: GuildConfigMap[];
}

export interface MqttConfigInterface {
    host: string;
    port: number;
    username: string;
    password: string;
}

export interface RedisConfigInterface {
    dsn: string;
}

export interface GuildConfigMap {
    [guildId: string]: GuildConfigInterface;
}

export interface GuildConfigInterface {
    guildId: string;
    nickname: string;
    avatarUrl: string;
    topics: string[];
    malla: string;
    channels: string[];
}

class Config {
    content: ConfigInterface = {} as ConfigInterface;

    public async init() {
        try {
            const fileContent = await fsPromises.readFile("./config.json", 'utf-8');
            this.content = JSON.parse(fileContent) as ConfigInterface;

            if (this.content === undefined) {
                logger.error("Error reading in config.json");
            }

            // this.validateConfiguration();
            logger.info(`Version: ${this.content.version}`);
            logger.info(`Environment: ${this.content.environment}`);
        } catch (error: any) {
            logger.error(error)
        }
    }

    public validateConfiguration() {
        if (this.content === undefined) {
            throw new Error('Missing config.json');
        }

        if (this.content.discord.guilds.length === 0) {
            throw new Error('No configured guilds. Exiting');
        }
    }

    public getMallaURL(guildId: string | null) {
        if (this.content === undefined || guildId === null) {
            return 'malla.tnmesh.org';
        }

        return this.content.discord.guilds[guildId].malla;
    }

    public getDiscordChannelForMeshChannel(guildId: string, channelName: string) {
        const channelId = this.content?.discord.guilds[guildId].channels[channelName];

        if (channelId === undefined) {
            return this.content?.discord.guilds[guildId].channels['default'];
        }

        return channelId;
    }

    public hasGuild(guildId: string) {
        // const key = guildId keyof GuildConfigMap;
        return this.content?.discord.guilds[guildId] !== undefined;
    }

    public getGuildConfig(guildId: String): GuildConfigInterface | undefined {
        return this.content?.discord.guilds[guildId];
    }

    public getGuildsForTopic(topic: string): string[] {
        const guildIds: string[] = [];

        for (const [key, config] of Object.entries(this.content.discord.guilds)) {
            const topics: string[] = config.topics;

            topics.forEach((t: string) => {
                if (topic.startsWith(t)) {
                    guildIds.push(key)
                }
            })
        }

        return [...new Set(guildIds)];
    }

    public getGuilds(): GuildConfigInterface[] {
        const configs: GuildConfigInterface[] = [];

        for (const [key, config] of Object.entries(this.content.discord.guilds)) {
            config['guildId'] = key;
            configs.push(config);
        }

        return configs;
    }
}

const config = new Config();
export default config;