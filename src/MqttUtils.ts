import { ServiceEnvelope, Position, User } from "../index";
import MeshPacketCache from "./MeshPacketCache";
import { decrypt } from "./decrypt";
import meshRedis from "./MeshRedis";
import { nodeId2hex } from "./NodeUtils";
import logger from "./Logger";
import { Message } from "protobufjs";
import meshDB from "MeshDB";
import config from "Config";

const handleMqttMessage = async (topic, message, meshPacketCache, NODE_INFO_UPDATES) => {
  try {
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
    }
  } catch (err) {
    logger.error("Error: " + String(err));
  }
};

export { handleMqttMessage };
