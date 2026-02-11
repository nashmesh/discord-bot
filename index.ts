import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  MessageFlags,
  GuildMember,
  User as DiscordUser,
  userMention,
  chatInputApplicationCommandMention,
  Message,
} from "discord.js";
import { fileURLToPath } from "url";
import path, { dirname } from "path";
import protobufjs from "protobufjs";
import crypto from "crypto";
import mqtt from "mqtt";

import FifoCache from "./src/FifoCache";
import MeshPacketCache, {
  PacketGroup,
} from "./src/MeshPacketCache";
import meshRedis from "./src/MeshRedis";
import meshDB from "./src/MeshDB";
import config from "./src/Config";
import logger from "./src/Logger";
import { CommandMessageType, CommandType, commands, messageCommands } from "./src/Commands";
import { fetchDiscordChannel } from "./src/DiscordUtils";
import { processTextMessage } from "./src/MessageUtils";
import { handleMqttMessage } from "./src/MqttUtils";
import LinkCommandMessage from "./src/commands/message/LinkCommandMessage";

// generate a pseduo uuid kinda thing to use as an instance id
const INSTANCE_ID = (() => {
  return crypto.randomBytes(4).toString("hex");
})();
logger.init(INSTANCE_ID);

logger.info("Starting Mesh Logger");

const DISCORD_CLIENT_ID = process.env["DISCORD_CLIENT_ID"];
const DISCORD_TOKEN = process.env["DISCORD_TOKEN"];
const DISCORD_GUILD = process.env["DISCORD_GUILD"];
const REDIS_URL = process.env["REDIS_URL"];
const NODE_INFO_UPDATES = process.env["NODE_INFO_UPDATES"] === "1";
const MQTT_BROKER_URL = process.env["MQTT_BROKER_URL"];
const MQTT_TOPICS = JSON.parse(process.env["MQTT_TOPICS"] || "[]");

if (MQTT_BROKER_URL === undefined || MQTT_BROKER_URL.length === 0) {
  throw new Error("MQTT_BROKER_URL is not set");
}

if (REDIS_URL === undefined || REDIS_URL.length === 0) {
  throw new Error("REDIS_URL is not set");
}

if (DISCORD_CLIENT_ID === undefined || DISCORD_CLIENT_ID.length === 0) {
  throw new Error("DISCORD_CLIENT_ID is not set");
}

if (DISCORD_TOKEN === undefined || DISCORD_TOKEN.length === 0) {
  throw new Error("DISCORD_TOKEN is not set");
}

if (DISCORD_GUILD === undefined || DISCORD_GUILD.length === 0) {
  throw new Error("DISCORD_GUILD is not set");
}

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
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

await config.init();
await meshRedis.init(REDIS_URL);
await meshDB.init();

// Register the slash command with Discord using the REST API.
const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

(async () => {
  try {
    logger.info("Started refreshing application (/) commands.");

    // Register the command for a specific guild (for development, guild commands update faster).
    await rest.put(
      Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD),
      {
        body: commands,
      },
    );

    logger.info("Successfully reloaded application (/) commands.");
  } catch (error) {
    logger.error(error);
  }
})();

// When Discord client is ready, start the MQTT connection.
client.once("ready", () => {
  logger.info(`Logged in as ${client.user.tag}!`);

  const guild = client.guilds.cache.find((g) => g.id === DISCORD_GUILD);
  if (!guild) {
    logger.error("No guild available for the bot");
    return;
  } else {
    logger.info(JSON.stringify(guild));
  }

  // Connect to the MQTT broker.
  const mqttClient = mqtt.connect(MQTT_BROKER_URL, {
    username: "meshdev",
    password: "large4cats",
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
    if (message.guildId !== DISCORD_GUILD) {
      logger.warn("Received message from non-guild");
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
        await linkCommand.handle(message.guild, commandArguments, message);
        return;
      }

      // Otherwise, is this a generic command?
      const command: CommandMessageType | undefined = getMessageCommand(commandName);
      if (command === undefined) {
        return;
      }

      (<CommandMessageType>command).class.handle(guild, commandArguments, message);
    }
  });

  // Interactions
  client.on("interactionCreate", async (interaction) => {
    if (interaction.guildId !== DISCORD_GUILD) {
      logger.warn("Received interaction from non-guild");
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const commandName: string = interaction.commandName;
    const command: CommandType | undefined = getCommand(commandName);

    if (command === undefined) {
      return;
    }

    (<CommandType>command).class.handle(interaction);
  });

  // Collect packet groups every 5 seconds
  setInterval(() => {
    const packetGroups = meshPacketCache.getDirtyPacketGroups();
    // logger.info("Processing " + packetGroups.length + " packet groups");
    packetGroups.forEach((packetGroup: PacketGroup) => {
      // processPacketGroup(packetGroup);
      if (packetGroup.serviceEnvelopes[0].packet?.decoded?.portnum === 3) {
        logger.info("Processing packet group: " + packetGroup.id + " POSITION");
      } else {
        logger.info(
          "Processing packet group: " +
            packetGroup.id +
            " with text: " +
            packetGroup.serviceEnvelopes[0].packet.decoded.payload.toString(),
        );
      }
      processTextMessage(packetGroup, client, guild, discordMessageIdCache);
    });
  }, 5000);

  mqttClient.on("error", (err) => {
    logger.error("MQTT Client Error:", err);
  });

  mqttClient.on("connect", () => {
    logger.info("Connected to MQTT broker");
    // Subscribe to the topic where your packets are published.
    mqttClient.subscribe("msh/US/#", (err) => {
      if (err) {
        logger.error("Error subscribing to MQTT topic:", err);
      } else {
        logger.info("Subscribed to MQTT topic");
      }
    });
  });

  mqttClient.on("message", async (topic, message) => {
    await handleMqttMessage(topic, message, MQTT_TOPICS, meshPacketCache, NODE_INFO_UPDATES, MQTT_BROKER_URL);
  });
});

// Log in to Discord.
client.login(DISCORD_TOKEN);
