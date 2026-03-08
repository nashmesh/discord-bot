import { nodeId2hex } from "./NodeUtils";
import { createDiscordMessage } from "./DiscordMessageUtils";
import meshRedis from "./MeshRedis";
import logger from "./Logger";
import { PacketGroup } from "./MeshPacketCache";
import { Client, Guild } from "discord.js";
import config from "Config";
import { fetchDiscordChannel } from "DiscordUtils";

const processTextMessage = async (packetGroup: PacketGroup, client: Client, guild: Guild, discordMessageIdCache) => {
  const packet = packetGroup.serviceEnvelopes[0].packet;
  const packetTopic = packetGroup.serviceEnvelopes[0].topic;
  let text = packet.decoded.payload.toString();
  const to = nodeId2hex(packet.to);
  const portNum = packet?.decoded?.portnum;

  if (portNum === 3) {
    text = "Position Packet";
  }

  // discard text messages in the form of "seq 6034" "seq 6025"
  if (text.match(/^seq \d+$/)) {
    return;
  }

  if (process.env.ENVIRONMENT === "production" && to !== "ffffffff") {
    logger.info(
      `MessageId: ${packetGroup.id} Not to public channel: ${packetGroup.serviceEnvelopes.map((envelope) => envelope.topic)}`,
    );
    return;
  }

  const topicsForGuild: [] = config.content?.discord.guilds[guild.id].topics ?? null;
  if (topicsForGuild === null) {
    logger.info('no topics for guild')
    return;
  }

  let hasTopic = false;
  topicsForGuild.forEach((topic) => {
    hasTopic ||= packetTopic.startsWith(topic);
  });

  if (!hasTopic) {
    logger.info(`No topic found for packet_topic=${packetTopic} on ${guild.id}`);
    return;
  }

  const nodeId = nodeId2hex(packet.from);

  // Check if the node is banned
  const isBannedNode = await meshRedis.isBannedNode(nodeId);
  if (isBannedNode) {
    logger.info(`Node ${nodeId} is banned. Ignoring message.`);
    return;
  }

  const balloonNode = await meshRedis.isBalloonNode(nodeId);
  const channelId = packetGroup.serviceEnvelopes[0].channelId;
  const content = await createDiscordMessage(packetGroup, text, balloonNode, client, guild, channelId);

  let discordChannel = fetchDiscordChannel(guild, config.getDiscordChannelForMeshChannel(guild.id, channelId));

  if (discordChannel === null) {
    logger.warn(
      "No discord channel found for channelId: " +
        packetGroup.serviceEnvelopes[0].channelId,
    );
    return;
  }

  if (discordMessageIdCache.exists(packet.id.toString())) {
    // update original message
    logger.info("Updating message: " + packet.id.toString());
    const discordMessageId = discordMessageIdCache.get(packet.id.toString());
    const originalMessage =
      await discordChannel.messages.fetch(discordMessageId);
    originalMessage.edit(content);
  } else {
    // send new message
    logger.info("Sending message: " + packet.id.toString());
    let discordMessage;

    if (
      packet.decoded.replyId &&
      packet.decoded.replyId > 0 &&
      discordMessageIdCache.exists(packet.decoded.replyId.toString())
    ) {
      const discordMessageId = discordMessageIdCache.get(
        packet.decoded.replyId.toString(),
      );

      const existingMessage =
        await discordChannel.messages.fetch(discordMessageId);
      discordMessage = await existingMessage.reply(content);
    } else {
      discordMessage = await discordChannel.send(content);
    }
    // store message id in cache
    discordMessageIdCache.set(packet.id.toString(), discordMessage.id);
  }
};

export { processTextMessage };
