import { GuildMember, User as DiscordUser, userMention, Guild, Client } from "discord.js";
import { nodeHex2id, nodeId2hex, validateNodeId } from "./NodeUtils";
import meshRedis from "./MeshRedis";
import logger from "./Logger";
import { DecodedPosition, decodedPositionToString, PacketGroup } from "./MeshPacketCache";
import { Position } from "..";
import meshDB from "MeshDB";
import { Flag, Node } from "generated/prisma/client";
import { FlagRepository } from "@repositories/FlagRepository";
import { FlagProperties, Flags } from "Flags";
import config from "Config";

export const createDiscordMessage = async (packetGroup: PacketGroup, text: string, balloonNode: boolean, client: Client, guild: Guild, channelId: string) => {
  try {
    const mallaUrl = config.getMallaURL(guild.id);
    const packet = packetGroup.serviceEnvelopes[0].packet;
    const from = nodeId2hex(packet.from);
    const nodeIdHex = nodeId2hex(from);
    const portNum = packet?.decoded?.portnum;
    logger.info(`portNum: ${portNum}`);
    let msgText = text;

    let nodeInfos = await meshRedis.getNodeInfos(
      packetGroup.serviceEnvelopes
        .map((se) => se.gatewayId.replace("!", ""))
        .concat(from),
      false,
    );

    let avatarUrl = "https://cdn.discordapp.com/embed/avatars/0.png";

    const maxHopStart = packetGroup.serviceEnvelopes.reduce((acc, se) => {
      const hopStart = se.packet.hopStart;
      return hopStart > acc ? hopStart : acc;
    }, 0);

    const getNodeOwner = async (hexId: string): Promise<string | null> => {
      const nodeId = validateNodeId(hexId);

      if (nodeId === null) {
        return null;
      }

      let payload: Node = await meshDB.client.node.findFirst({
        where: {
          hexId: nodeId
        }
      });

      if (payload && payload.discordId) {
        return payload.discordId;
      }
      return null;
    }

    const nodeOwner = await getNodeOwner(nodeIdHex.replace('!', ''));
    logger.info(`nodeIdHex: ${nodeIdHex}, discordUserId: ${nodeOwner}`);

    let ownerField;
    if (nodeOwner) {
      let guildUser: GuildMember | DiscordUser | undefined;
      const user: DiscordUser = await client.users.fetch(nodeOwner);

      try {
        guildUser = await guild.members.fetch(nodeOwner);
      } catch (e) {
        logger.error(e);
      }

      if (!guildUser) {
        logger.error(
          `User ${nodeOwner} not found in guild, using global user.`,
        );

        guildUser = user;
      }

      const userAvatarUrl = guildUser.displayAvatarURL();
      if (userAvatarUrl && userAvatarUrl.length > 0) {
        avatarUrl = userAvatarUrl;
      }
      ownerField = {
        name: "Owner",
        value: userMention(guildUser.id),
        inline: false,
      };
    }

    const gatewayCount = packetGroup.serviceEnvelopes.filter(
      (value, index, self) =>
        self.findIndex((t) => t.gatewayId === value.gatewayId) === index,
    ).length;

    logger.info(`gatewayCount: ${gatewayCount}`);

    const infoFields: any = [];

    let mapImageUrl = "";
    let mapUrl = "";

    let lastPosition = await meshRedis.getLastPosition(from);
    if (lastPosition) {
      lastPosition = JSON.parse(lastPosition);
      logger.info(`Found last position for ${from}`);

      mapImageUrl = `https://api.smerty.org/api/v1/maps/static?lat=${lastPosition.latitude / 10000000}&lon=${lastPosition.longitude / 10000000}&width=400&height=100&zoom=12`;
      mapUrl = `https://map.tnmesh.org/?node_id=${nodeHex2id(from)}&zoom=13`
      logger.info(mapImageUrl)
      logger.info(mapUrl)
    }

    if (ownerField) {
      infoFields.push({
        name: ownerField.name,
        value: ownerField.value,
        inline: ownerField.inline,
      });
    }

    infoFields.push({
      name: "Packet",
      value: `[${packetGroup.id.toString(16)}](https://${mallaUrl}/mesh-packet/${packetGroup.id})`,
      inline: true,
    });

    if (balloonNode) {
      infoFields.push({
        name: "Channel",
        value: `${packetGroup.serviceEnvelopes[0].channelId}`,
        inline: true,
      });
    }

    infoFields.push({
      name: "Hop Limit",
      value: `${maxHopStart}`,
      inline: true,
    });
    infoFields.push({
      name: "Gateway Count",
      value: `${gatewayCount}`,
      inline: true,
    });

    const gatewayGroups = {};

    packetGroup.serviceEnvelopes
      .filter(
        (value, index, self) =>
          self.findIndex((t) => t.gatewayId === value.gatewayId) === index,
      )
      .forEach((envelope) => {
        const gatewayDelay =
          envelope.mqttTime.getTime() - packetGroup.time.getTime();
        let gatewayDisplayName = envelope.gatewayId.replace("!", "");
        if (nodeInfos[gatewayDisplayName]) {
          gatewayDisplayName = nodeInfos[gatewayDisplayName].shortName;
        }

        let hopText;
        if (
          typeof envelope.packet.hopStart === "number" &&
          typeof envelope.packet.hopLimit === "number"
        ) {
          hopText = ``;
          if (
            envelope.packet.hopStart === 0 &&
            envelope.packet.hopLimit === 0
          ) {
            hopText = `(${envelope.packet.rxSnr} / ${envelope.packet.rxRssi} dBm)`;
          } else if (
            envelope.packet.hopStart - envelope.packet.hopLimit ===
            0
          ) {
            hopText = `(${envelope.packet.rxSnr} / ${envelope.packet.rxRssi} dBm)`;
          }
          if (envelope.gatewayId.replace("!", "") === nodeIdHex) {
            hopText = `(Self Gated)`;
          }
          // if (maxHopStart !== envelope.packet.hopStart) {
          // }
          // if (envelope.mqttServer === "public") {
          // }
        } else {
          hopText = "Unknown";
        }

        let hopGroup;
        if (
          typeof envelope.packet.hopStart === "number" &&
          typeof envelope.packet.hopLimit === "number" &&
          maxHopStart === envelope.packet.hopStart
        ) {
          hopGroup = envelope.packet.hopStart - envelope.packet.hopLimit;
        } else {
          hopGroup = "Unknown Hops";
        }

        const gatewayFieldText =
          `[${gatewayDisplayName} ${hopText}` +
          `](https://${mallaUrl}/node/${nodeHex2id(envelope.gatewayId.replace("!", ""))})`;

        if (!gatewayGroups[hopGroup]) {
          gatewayGroups[hopGroup] = [];
        }
        gatewayGroups[hopGroup].push(gatewayFieldText);
      });

    const gatewayFields2: any = [];
    Object.keys(gatewayGroups)
      .sort((a, b) => {
        if (a === "Unknown Hops") return 1;
        if (b === "Unknown Hops") return -1;
        return a - b;
      })
      .forEach((hop) => {
        const baseName =
          hop === "Unknown Hops"
            ? "Unknown Hops"
            : hop === "0"
              ? "Direct"
              : `${hop} hops`;

        const lines = gatewayGroups[hop];
        let currentChunk = "";
        let fieldIndex = 0;

        lines.forEach((line) => {
          if (
            currentChunk.length +
            line.length +
            (currentChunk.length > 0 ? 1 : 0) >
            1024
          ) {
            gatewayFields2.push({
              name: fieldIndex === 0 ? baseName : `${baseName} continued`,
              value: currentChunk,
              inline: false,
            });
            fieldIndex++;
            currentChunk = line;
          } else {
            currentChunk =
              currentChunk.length > 0
                ? currentChunk + (hop === "0" ? "\n" : " | ") + line
                : line;
          }
        });

        if (currentChunk.length > 0) {
          gatewayFields2.push({
            name: fieldIndex === 0 ? baseName : `${baseName} (continued)`,
            value: currentChunk,
            inline: false,
          });
        }
      });

    const content = {
      username: "Mesh Bot",
      avatar_url:
        "https://cdn.discordapp.com/app-icons/1240017058046152845/295e77bec5f9a44f7311cf8723e9c332.png",
      embeds: [
        {
          url: `https://${mallaUrl}/node/${packet.from}`,
          color: 6810260,
          timestamp: new Date(packet.rxTime * 1000).toISOString(),

          author: {
            name: `${nodeInfos[nodeIdHex] ? nodeInfos[nodeIdHex].longName : "Unknown"}`,
            url: `https://${mallaUrl}/node/${packet.from}`,
            icon_url: avatarUrl,
          },
          title: `${nodeInfos[nodeIdHex] ? nodeInfos[nodeIdHex].shortName : "UNK"}`,
          description: msgText,
          fields: [...infoFields, ...gatewayFields2].slice(0, 25),
          footer: {
            text: `#${channelId}`
          }
        },
      ],
    };

    const showPosition = await canShowPosition(nodeIdHex);

    if (mapImageUrl && showPosition) {
      content.embeds[0].image = {
        url: mapImageUrl,
      };
    }

    return content;
  } catch (err) {
    logger.error("Error: " + String(err));
  }
};

async function canShowPosition(nodeId: string): Promise<boolean> {
  const node: Node = await meshDB.client.node.findFirst({
    where: {
      hexId: nodeId
    }
  })

  if (!node) {
    return false;
  }

  const flag: Flag = await FlagRepository.getFlag(node, Flags.SHOW_POSITION.key);
  if (!flag) {
    const flagProperties: FlagProperties = Flags.getFlagProperties(Flags.SHOW_POSITION.key);

    return flagProperties.default as boolean ?? false;
  }

  // type check since flag values are stored as Json
  if (typeof flag.value === 'boolean') {
    return flag.value;
  }

  return false;
}
