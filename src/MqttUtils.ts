import { ServiceEnvelope, Position, User } from "../index";
import MeshPacketCache, { ServiceEnvelope as MeshServiceEnvelope, MeshPlatform } from "./MeshPacketCache";
import { decrypt } from "./decrypt";
import meshRedis from "./MeshRedis";
import { nodeId2hex } from "./NodeUtils";
import logger from "./Logger";
import { Message } from "protobufjs";
import meshDB from "MeshDB";
import config from "Config";
import crypto from "crypto";

const handleMqttMessage = async (topic, message, meshPacketCache, NODE_INFO_UPDATES) => {
  try {
    const platform: MeshPlatform = topic.startsWith("meshcore") ? 'meshcore' : 'meshtastic';

    if (topic.includes("msh")) {
      if (!topic.includes("/json")) {
        if (topic.includes("/stat/")) {
          return;
        }
        let envelope: Message<{}>;

        try {
          envelope = ServiceEnvelope.decode(message);
        } catch (envDecodeErr) {
          if (
            String(envDecodeErr).indexOf(
              "invalid wire type 7 at offset 1",
            ) === -1
          ) {
            logger.error(
              `MessageId: Error decoding service envelope: ${envDecodeErr}`,
            );
          }
          return;
        }
        if (!envelope || !envelope.packet) {
          logger.error("[handleMqttCommand] Invalid service envelope decoded");
          return;
        }

        if (
          ["msh/US"].some((t) => {
            return topic.startsWith(t);
          }) ||
          meshPacketCache.exists(envelope.packet.id)
        ) {
          const isEncrypted = envelope.packet.encrypted?.length > 0;
          if (isEncrypted) {
            const decoded = decrypt(envelope.packet);
            if (decoded) {
              envelope.packet.decoded = decoded;
            }
          }

          const portnum = envelope.packet?.decoded?.portnum;
          const from = envelope.packet.from.toString(16);

          const exists = await meshDB.client.node.findFirst({
            where: {
              hexId: from
            }
          });

          if (!exists) {
            await meshDB.client.node.create({
              data: {
                hexId: from
              }
            });
          }

          if (portnum === 1) {
            (envelope as any).platform = platform;
            meshPacketCache.add(envelope, topic, config.content.mqtt.host);
          } else if (portnum === 3) {
            // const from = envelope.packet.from.toString(16);

            const position: Message = Position.decode(envelope.packet.decoded.payload);

            if (!position || (!position.latitudeI && !position.longitudeI)) {
              return;
            }

            await meshRedis.setLastPosition(from, position.latitudeI, position.longitudeI);
            // meshPacketCache.add(envelope, topic, MQTT_BROKER_URL);
          } else if (portnum === 4) {
            if (!NODE_INFO_UPDATES) {
              logger.info("Node info updates disabled");
              return;
            }
            const user = User.decode(envelope.packet.decoded.payload);
            // const from = nodeId2hex(envelope.packet.from);

            await meshDB.client.node.update({
              data: {
                longName: user.longName,
              },
              where: {
                hexId: from
              }
            });

            meshRedis.updateNodeDB(
              from,
              user.longName,
              user,
              envelope.packet.hopStart,
            );
          }
        }
      }
    } else if (topic.includes("meshcore")) {
      try {
        const payload = JSON.parse(message.toString());
        logger.info(`[meshcore] raw: ${JSON.stringify(payload)}`);

        if (payload.type === "PACKET" && (payload.packet_type === "3" || payload.packet_type === "5")) {
          const rawBytes = Buffer.from(payload.raw, 'hex');

          // Parse path length byte: bits 6-7 = hash size code (size = code+1), bits 0-5 = hop count
          let offset = 1;
          const pathLenByte = rawBytes[offset++];
          const hashSize = (pathLenByte >> 6) + 1;
          const hopCount = pathLenByte & 0x3F;
          offset += hopCount * hashSize;

          // Content hash: SHA256(header + payload), path-independent — same across all observers
          const contentHash = crypto.createHash('sha256')
            .update(Buffer.concat([rawBytes.slice(0, 1), rawBytes.slice(offset)]))
            .digest('hex').slice(0, 16).toUpperCase();

          // GRP_TXT payload: [channel_hash: 1][mac: 2][ciphertext: rest]
          const channelHashHex = rawBytes[offset++].toString(16).padStart(2, '0');
          const mac = rawBytes.slice(offset, offset + 2);
          offset += 2;
          const ciphertext = rawBytes.slice(offset);

          // Try each configured channel key
          const channelKeys: Record<string, string> = config.content.meshcore?.channels ?? {};
          let decrypted = false;

          for (const [channelName, keyHex] of Object.entries(channelKeys)) {
            const key = Buffer.from(keyHex, 'hex');
            if (key.length !== 16) continue;

            // HMAC-SHA256 verification: secret = key + 16 zero bytes
            const channelSecret = Buffer.concat([key, Buffer.alloc(16, 0)]);
            const expectedMac = crypto.createHmac('sha256', channelSecret).update(ciphertext).digest();
            if (expectedMac[0] !== mac[0] || expectedMac[1] !== mac[1]) continue;

            // AES-128-ECB decrypt
            const cipher = crypto.createDecipheriv('aes-128-ecb', key, null);
            cipher.setAutoPadding(false);
            const plaintext = Buffer.concat([cipher.update(ciphertext), cipher.final()]);

            // Plaintext: [timestamp: 4 LE][flags: 1][sender: message\0]
            const text = plaintext.slice(5).toString('utf8').split('\0')[0];
            const colonIdx = text.indexOf(': ');
            const sender = colonIdx > 0 ? text.slice(0, colonIdx) : payload.origin;
            const messageText = colonIdx > 0 ? text.slice(colonIdx + 2) : text;

            logger.info(`[meshcore] [${channelName}] id=${contentHash} hops=${hopCount} observer=${payload.origin} observer_id=${payload.origin_id.toLowerCase()} from=${sender}: ${messageText}`);

            const packetId = parseInt(contentHash.slice(0, 8), 16);
            const fromId = parseInt(payload.origin_id.slice(0, 8), 16);

            const envelope: MeshServiceEnvelope = {
              packet: {
                from: fromId,
                to: 0xFFFFFFFF,
                channel: 0,
                encrypted: Buffer.alloc(0),
                id: packetId,
                rxTime: Math.floor(new Date(payload.timestamp).getTime() / 1000),
                rxSnr: parseFloat(payload.SNR ?? '0'),
                hopLimit: 0,
                hopStart: hopCount,
                wantAck: false,
                rxRssi: parseInt(payload.RSSI ?? '0'),
                decoded: {
                  portnum: 1,
                  payload: Buffer.from(`${sender}: ${messageText}`),
                },
              },
              mqttTime: new Date(),
              channelId: channelName,
              gatewayId: payload.origin_id.toLowerCase(),
              topic,
              mqttServer: config.content.mqtt.host,
              platform: 'meshcore',
              contentHash: contentHash.toLowerCase(),
            };

            meshPacketCache.add(envelope, topic, config.content.mqtt.host);
            decrypted = true;
            break;
          }

          if (!decrypted) {
            logger.info(`[meshcore] no key matched channel 0x${channelHashHex} id=${contentHash} (origin=${payload.origin})`);
          }
        }
      } catch (e) {
        logger.error(`[meshcore] Failed to parse: ${e}`);
      }
    }
  } catch (err) {
    logger.error("Error: " + String(err));
  }
};

export { handleMqttMessage };
