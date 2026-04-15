import { nodeId2hex } from "./NodeUtils";
import { createDiscordMessage } from "./DiscordMessageUtils";
import meshRedis from "./MeshRedis";
import logger from "./Logger";
import { PacketGroup } from "./MeshPacketCache";
import { Client, Guild, EmbedBuilder } from "discord.js";
import config from "Config";
import { fetchDiscordChannel } from "DiscordUtils";

const processTextMessage = async (packetGroup: PacketGroup, client: Client, guild: Guild, discordMessageIdCache) => {
  const platform = packetGroup.serviceEnvelopes[0].platform;

  if (platform === 'meshcore') {
    return processMeshcoreMessage(packetGroup, client, guild, discordMessageIdCache);
  }

  return processMeshtasticMessage(packetGroup, client, guild, discordMessageIdCache);
};

const processMeshtasticMessage = async (packetGroup: PacketGroup, client: Client, guild: Guild, discordMessageIdCache) => {
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
    logger.info("Updating message: " + packet.id.toString());
    const discordMessageId = discordMessageIdCache.get(packet.id.toString());
    const originalMessage = await discordChannel.messages.fetch(discordMessageId);
    originalMessage.edit(content);
  } else {
    logger.info("Sending message: " + packet.id.toString());
    let discordMessage;

    if (
      packet.decoded.replyId &&
      packet.decoded.replyId > 0 &&
      discordMessageIdCache.exists(packet.decoded.replyId.toString())
    ) {
      const discordMessageId = discordMessageIdCache.get(packet.decoded.replyId.toString());
      const existingMessage = await discordChannel.messages.fetch(discordMessageId);
      discordMessage = await existingMessage.reply(content);
    } else {
      discordMessage = await discordChannel.send(content);
    }
    discordMessageIdCache.set(packet.id.toString(), discordMessage.id);
  }
};

const processMeshcoreMessage = async (packetGroup: PacketGroup, client: Client, guild: Guild, discordMessageIdCache) => {
  const envelope = packetGroup.serviceEnvelopes[0];
  const packet = envelope.packet;
  const packetTopic = envelope.topic;

  const topicsForGuild: [] = config.content?.discord.guilds[guild.id].topics ?? null;
  if (topicsForGuild === null) {
    logger.info('[meshcore] no topics for guild');
    return;
  }

  let hasTopic = false;
  topicsForGuild.forEach((topic) => {
    hasTopic ||= packetTopic.startsWith(topic);
  });

  if (!hasTopic) {
    logger.info(`[meshcore] no topic found for packet_topic=${packetTopic} on ${guild.id}`);
    return;
  }

  const rawText = packet.decoded.payload.toString();
  const colonIdx = rawText.indexOf(': ');
  const sender = colonIdx > 0 ? rawText.slice(0, colonIdx) : envelope.gatewayId;
  const messageText = colonIdx > 0 ? rawText.slice(colonIdx + 2) : rawText;

  const channelId = envelope.channelId;
  const discordChannel = fetchDiscordChannel(guild, config.getDiscordChannelForMeshChannel(guild.id, channelId));

  if (discordChannel === null) {
    logger.warn(`[meshcore] no discord channel found for channelId: ${channelId}`);
    return;
  }

  const uniqueObservers = packetGroup.serviceEnvelopes.filter(
    (se, i, self) => self.findIndex(s => s.gatewayId === se.gatewayId) === i
  );

  const observerLines = uniqueObservers.map(se => {
    const shortId = se.gatewayId.slice(0, 4).toLowerCase();
    return `[${shortId}](https://analyzer.nashme.sh/#/nodes/${se.gatewayId}) (${se.packet.rxSnr} / ${se.packet.rxRssi} dBm)`;
  });

  const observerFields = observerLines.length > 0 ? [{
    name: 'Observers',
    value: observerLines.join('\n'),
    inline: false,
  }] : [];

  const embed = new EmbedBuilder()
    .setAuthor({ name: sender, url: `https://analyzer.nashme.sh/#/nodes/${envelope.gatewayId}` })
    .setDescription(messageText)
    .addFields(
      { name: 'Packet', value: `[${envelope.contentHash.slice(0, 8)}](https://analyzer.nashme.sh/#/packets/${envelope.contentHash})`, inline: true },
      { name: 'Observer Count', value: `${uniqueObservers.length}`, inline: true },
      ...observerFields,
    )
    .setTimestamp(new Date(packet.rxTime * 1000))
    .setFooter({ text: `#${channelId}` });

  if (discordMessageIdCache.exists(packet.id.toString())) {
    logger.info('[meshcore] updating message: ' + packet.id.toString());
    const discordMessageId = discordMessageIdCache.get(packet.id.toString());
    const originalMessage = await discordChannel.messages.fetch(discordMessageId);
    await originalMessage.edit({ embeds: [embed] });
  } else {
    logger.info('[meshcore] sending message: ' + packet.id.toString());
    const discordMessage = await discordChannel.send({ embeds: [embed] });
    discordMessageIdCache.set(packet.id.toString(), discordMessage.id);
  }
};

export { processTextMessage };
