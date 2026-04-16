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
                hexId: from,
                platform: 'meshtastic',
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

          // Parse header: bits 0-1 = route type, bits 2-5 = payload type, bits 6-7 = payload version
          let offset = 0;
          const headerByte = rawBytes[offset++];
          const routeType = headerByte & 0x03;

          // ROUTE_TYPE_TRANSPORT_FLOOD (0x00) and ROUTE_TYPE_TRANSPORT_DIRECT (0x03) include
          // 4 bytes of transport codes between the header and path_length
          if (routeType === 0x00 || routeType === 0x03) {
            offset += 4;
          }

          // Parse path_length: bits 6-7 = hash size code (size = code+1, max 3), bits 0-5 = hop count
          const pathLenByte = rawBytes[offset++];
          const hashSize = Math.min((pathLenByte >> 6) + 1, 3);
          const hopCount = pathLenByte & 0x3F;

          // First path entry is the sender's truncated hash (if path is non-empty)
          const pathStart = offset;
          const senderHashHex = hopCount > 0
            ? rawBytes.slice(pathStart, pathStart + hashSize).toString('hex')
            : null;

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

            // Plaintext: [timestamp: 4 LE][txt_type+attempt: 1][message]
            // Use the plaintext's 4-byte LE Unix timestamp as the authoritative send time.
            // This avoids timezone ambiguity in payload.timestamp (some nodes report local time
            // without a UTC offset, causing ~5-hour skew for CDT nodes).
            const plaintextTimestamp = plaintext.readUInt32LE(0);

            // txt_type is upper 6 bits of byte 4:
            //   0x00 = plain text  → message starts at byte 5
            //   0x02 = signed      → bytes 5-8 are sender pubkey prefix (4 bytes), message at byte 9
            const txtTypeByte = plaintext[4];
            const txtType = (txtTypeByte >> 2) & 0x3F;

            let senderPubkeyHex: string | null = null;
            let rawText: string;

            if (txtType === 0x02) {
              senderPubkeyHex = plaintext.slice(5, 9).toString('hex');
              rawText = plaintext.slice(9).toString('utf8').split('\0')[0];
            } else {
              rawText = plaintext.slice(5).toString('utf8').split('\0')[0];
            }

            const colonIdx = rawText.indexOf(': ');
            const sender = colonIdx > 0 ? rawText.slice(0, colonIdx) : payload.origin;
            const messageText = colonIdx > 0 ? rawText.slice(colonIdx + 2) : rawText;

            logger.info(`[meshcore] [${channelName}] id=${contentHash} hops=${hopCount} observer=${payload.origin} observer_id=${payload.origin_id.toLowerCase()} sender_pubkey=${senderPubkeyHex ?? 'none'} from=${sender}: ${messageText}`);

            const packetId = parseInt(contentHash.slice(0, 8), 16);
            const fromId = senderPubkeyHex
              ? parseInt(senderPubkeyHex, 16)
              : senderHashHex
                ? parseInt(senderHashHex, 16)
                : parseInt(payload.origin_id.slice(0, 8), 16);

            const envelope: MeshServiceEnvelope = {
              packet: {
                from: fromId,
                to: 0xFFFFFFFF,
                channel: 0,
                encrypted: Buffer.alloc(0),
                id: packetId,
                rxTime: plaintextTimestamp,
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
        } else if (payload.type === "PACKET" && payload.packet_type === "4") {
          const rawBytes = Buffer.from(payload.raw, 'hex');

          // Parse header and skip transport codes if present
          let offset = 0;
          const headerByte = rawBytes[offset++];
          const routeType = headerByte & 0x03;
          if (routeType === 0x00 || routeType === 0x03) {
            offset += 4;
          }

          // Skip path
          const pathLenByte = rawBytes[offset++];
          const hashSize = Math.min((pathLenByte >> 6) + 1, 3);
          const hopCount = pathLenByte & 0x3F;
          offset += hopCount * hashSize;

          // Advert payload: [public_key: 32][timestamp: 4][signature: 64][appdata: rest]
          const advertPayload = rawBytes.slice(offset);

          if (advertPayload.length < 100) {
            logger.warn(`[meshcore] advert payload too short (${advertPayload.length} bytes), skipping`);
          } else {
            const publicKey = advertPayload.slice(0, 32).toString('hex').toLowerCase();
            const timestamp = advertPayload.readUInt32LE(32);
            // bytes 36–99 are the Ed25519 signature, skip
            const appdata = advertPayload.slice(100);

            let nodeName: string | null = null;
            let latitude: number | null = null;
            let longitude: number | null = null;

            if (appdata.length > 0) {
              const flags = appdata[0];
              let appdataOffset = 1;

              if (flags & 0x10) { // has location
                if (appdata.length >= appdataOffset + 8) {
                  latitude = appdata.readInt32LE(appdataOffset) / 1_000_000;
                  appdataOffset += 4;
                  longitude = appdata.readInt32LE(appdataOffset) / 1_000_000;
                  appdataOffset += 4;
                }
              }
              if (flags & 0x20) appdataOffset += 2; // feature1 (reserved)
              if (flags & 0x40) appdataOffset += 2; // feature2 (reserved)
              if (flags & 0x80) { // has name
                nodeName = appdata.slice(appdataOffset).toString('utf8').replace(/\0/g, '').trim() || null;
              }
            }

            logger.info(`[meshcore] advert public_key=${publicKey} name=${nodeName} lat=${latitude} lon=${longitude} ts=${timestamp} hops=${hopCount} observer=${payload.origin_id?.toLowerCase()}`);

            await meshDB.client.node.upsert({
              where: { hexId: publicKey },
              update: { longName: nodeName },
              create: {
                hexId: publicKey,
                longName: nodeName,
                platform: 'meshcore',
              },
            });
          }
        } else if (topic.endsWith('/status') && payload.origin_id) {
          const originId = payload.origin_id.toLowerCase();
          const exists = await meshDB.client.node.findFirst({
            where: { hexId: originId }
          });

          if (!exists) {
            await meshDB.client.node.create({
              data: {
                hexId: originId,
                longName: payload.origin ?? null,
                platform: 'meshcore',
              }
            });
            logger.info(`[meshcore] stored new node from status: ${originId} (${payload.origin ?? 'unnamed'})`);
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
