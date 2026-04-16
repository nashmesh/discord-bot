import {
  Client,
  GatewayIntentBits,
  REST,
  User as DiscordUser,
  Message,
  MessageFlags,
  Routes,
  ApplicationCommandOptionType,
} from "discord.js";
import { fileURLToPath } from "url";
import path, { dirname } from "path";
import protobufjs from "protobufjs";
import crypto from "crypto";
import mqtt from "mqtt";

import FifoCache from "./src/FifoCache";
import MeshPacketCache, {
  PacketGroup,
  ServiceEnvelope,
} from "./src/MeshPacketCache";
import meshRedis from "./src/MeshRedis";
import meshDB from "./src/MeshDB";
import config from "./src/Config";
import logger from "./src/Logger";
import { CommandMessageType, CommandType, commands, messageCommands } from "./src/Commands";
import { processTextMessage } from "./src/MessageUtils";
import { handleMqttMessage } from "./src/MqttUtils";
import LinkCommandMessage from "./src/commands/message/LinkCommandMessage";
import { DiscordError } from "errors/error";
import { NodeError } from "errors/NodeError";
import HelpCommand from "./src/commands/HelpCommand";

// generate a pseduo uuid kinda thing to use as an instance id
const INSTANCE_ID = (() => {
  return crypto.randomBytes(4).toString("hex");
})();
logger.init(INSTANCE_ID);

logger.info("Starting Mesh Logger");

const NODE_INFO_UPDATES = true;
// const NODE_INFO_UPDATES = process.env["NODE_INFO_UPDATES"] === "1";
const RELOAD_COMMANDS = process.env["RELOAD_COMMANDS"] === "1";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// load protobufs
const root = new protobufjs.Root();
root.resolvePath = (origin, target) =>
  path.join(__dirname, "src/protobufs", target);
root.loadSync("meshtastic/mqtt.proto");
const Data = root.lookupType("Data");
const ServiceEnvelope = root.lookupType("ServiceEnvelope");
const Position = root.lookupType("Position");
const User = root.lookupType("User");

export { Data, ServiceEnvelope, Position, User };

const discordMessageIdCache = new FifoCache<string, string>();
const meshPacketCache = new MeshPacketCache();

const client: Client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
});

await config.init();
await meshRedis.init(config.content?.redis.dsn);
await meshDB.init();

const rest = new REST({ version: "10" }).setToken(config.content.discord.token);

// Register the slash command with Discord using the REST API.
(async () => {
  if (!RELOAD_COMMANDS) {
    logger.info("Skipping reloading commands");
    return;
  }
  try {
    logger.info("Started refreshing application (/) commands.");

    config.getGuilds().forEach(async (guildConfig) => {
      try {
        // Add help command once all commands are loaded into memory
        commands.push({
            name: "help",
            description: "View a help guide for a command",
            class: new HelpCommand,
            options: [
              {
                name: "command",
                type: ApplicationCommandOptionType.String,
                description: "The command to lookup",
                required: false,
                choices: commands.map((value) => {
                  return {
                    name: value.name,
                    value: value.name
                  }
                })
              },
            ],
        });

        await rest.put(
          Routes.applicationGuildCommands(config.content.discord.clientId, guildConfig.guildId),
          {
            body: commands,
          },
        );

        logger.info(`Successfully reloaded application (/) commands.`);
      } catch (error) {
        logger.error(error);
      }
    });
  } catch (error) {
    logger.error(error);
  }
})();

// When Discord client is ready, start the MQTT connection.
client.once("ready", () => {
  const user = client.user;

  if (user === null) {
    return;
  }

  let loaded = false;
  client.guilds.cache.forEach((guild) => {
    const guildConfig = config.getGuildConfig(guild.id);

    if (guildConfig === undefined) {
      return;
    }

    const bot = guild.members.cache.get(user.id);
    bot?.setNickname(
      guildConfig.nickname ?? config.content?.discord.nickname ?? 'Meshtastic Bot'
    );

    logger.info(`Logged in as ${guild.members.cache.get(user.id)?.nickname} on ${guild.name}!`);
    loaded = true;
  })

  if (!loaded) {
    logger.error("No channels found to join");
    return;
  }

  // Connect to the MQTT broker.
  const mqttClient = mqtt.connect(config.content.mqtt.host ?? 'mqtt.tnmesh.org', {
    username: config.content.mqtt.username,
    password: config.content.mqtt.password,
  });

  const getCommand = (commandName: string): CommandType | undefined => {
    return commands.filter((command: CommandType) => command.name === commandName)
      .pop();
  }

  const getMessageCommand = (commandName: string): CommandMessageType | undefined => {
    return messageCommands.filter((command: CommandMessageType) => command.name === commandName)
      .pop();
  }

  const getLinkCommand = (commandName: string): LinkCommandMessage | undefined => {
    let hasCommand = config.content?.availableLinkTypes.includes(commandName);

    if (!hasCommand) {
      return undefined;
    }

    return new LinkCommandMessage(commandName);
  }

  // Message
  client.on("messageCreate", async (message: Message) => {
    const guild = message.guild;

    if (guild === null) {
      logger.info(`Unhandled DM from ${message.author.globalName ?? 'Unknown User'}`)
      return;
    }

    if (!config.hasGuild(guild.id)) {
      return;
    }

    // Ignore messages sent from the bot
    if (message.author == client.user) {
      return;
    }

    let messageContent: string = message.content;
    if (messageContent.startsWith('!')) {
      // Remove the !
      messageContent = messageContent.substring(1, messageContent.length);
      let messageParts: string[] = messageContent.split(' ');

      // Grab command name and arguments
      let commandName = messageParts[0];
      let commandArguments = messageParts.slice(1, messageParts.length);

      // Is this a link command?
      const linkCommand: LinkCommandMessage | undefined = getLinkCommand(commandName);
      if (linkCommand !== undefined) {
        logger.info(`[linkCommand] ${message.author.displayName} used !${commandName}`);
        await linkCommand.handle(message.guild, commandArguments, message);
        return;
      }

      // Otherwise, is this a generic command?
      const command: CommandMessageType | undefined = getMessageCommand(commandName);
      if (command === undefined) {
        return;
      }

      logger.info(`[messageCommand] ${message.author.displayName} used !${commandName}`);
      (<CommandMessageType>command).class.handle(guild, commandArguments, message);
    }
  });

  // Interactions
  client.on("interactionCreate", async (interaction) => {
    const guild = interaction.guild;

    if (guild === null) {
      logger.info("Unhandled interaction");
      return;
    }

  if (!config.hasGuild(guild.id)) {
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const commandName: string = interaction.commandName;
    const command: CommandType | undefined = getCommand(commandName);

    if (command === undefined) {
      return;
    }

    logger.info(`[interactionCommand] ${interaction.user.globalName} used /${commandName}`);
    try {
      await (<CommandType>command).class.handle(interaction);
    } catch (error) {
      if (error instanceof DiscordError) {
        logger.error(`${interaction.user.globalName}: ${error.message}`);

        await interaction.reply({
            content: error.message,
            flags: MessageFlags.Ephemeral,
        });
        return;
      }

      logger.error(`${interaction.user.displayName}: ${error}`);

      await interaction.reply({
        content: 'Something went wrong with this command',
        flags: MessageFlags.Ephemeral,
      });
    }
  });

  // Collect packet groups every 5 seconds
  setInterval(() => {
    const packetGroups = meshPacketCache.getDirtyPacketGroups();

    packetGroups.forEach((packetGroup: PacketGroup) => {
      if (packetGroup.serviceEnvelopes[0].packet?.decoded?.portnum === 3) {
        logger.info("[packetProcessing] Processing packet group: " + packetGroup.id + " POSITION");
      } else {
        logger.info(
          "[packetProcessing] Processing packet group: " +
            packetGroup.id +
            " with text: " +
            packetGroup.serviceEnvelopes[0].packet.decoded.payload.toString(),
        );
      }

      let guildIds = config.getGuildsForTopic(packetGroup.serviceEnvelopes[0].topic);
      guildIds.forEach((guildId) => {
        let guild = client.guilds.cache.get(guildId);

        if (guild === undefined) {
          logger.error(`[packetProcessing] Failed sending to ${guildId}`);
          return;
        }

        logger.info(`[packetProcessing] Sending to ${guild.name}`);

        processTextMessage(packetGroup, client, guild, discordMessageIdCache);
      })

    });
  }, 5000);

  mqttClient.on("error", (err) => {
    logger.error(`MQTT Client Error: ${err}`);
  });

  mqttClient.on("connect", () => {
    logger.info("Connected to MQTT broker");
    // Subscribe to the topic where your packets are published.
    mqttClient.subscribe("msh/US/#", (err) => {
      if (err) {
        logger.error(`Error subscribing to MQTT topic: ${err}`);
      } else {
        logger.info("Subscribed to MQTT topic msh/US/#");
      }
    });

    mqttClient.subscribe("meshcore/#", (err) => {
      if (err) {
        logger.error(`Error subscribing to MQTT topic: ${err}`);
      } else {
        logger.info("Subscribed to MQTT topic meshcore/#");
      }
    });
  });

  mqttClient.on("message", async (topic, message) => {
    await handleMqttMessage(topic, message, meshPacketCache, NODE_INFO_UPDATES);
  });
});

// Log in to Discord.
client.login(config.content?.discord.token);
