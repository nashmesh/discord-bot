import config from "Config";
import { CacheType, ChatInputCommandInteraction } from "discord.js";
import { NodeError } from "errors/NodeError";
import logger from "Logger";

const nodeId2hex = (nodeId: string | number) => {
  return typeof nodeId === "number"
    ? nodeId.toString(16).padStart(8, "0")
    : nodeId;
};

const nodeHex2id = (nodeHex: string) => {
  return parseInt(nodeHex, 16);
};

const validateNodeId = (nodeId: string): string | null => {
  if (!nodeId || nodeId.trim().length === 0) {
    return null;
  }

  // MeshCore node: 64-char hex origin_id
  if (/^[0-9a-fA-F]{64}$/.test(nodeId)) {
    return nodeId.toLowerCase();
  }

  const hexRegex = /^[0-9a-fA-F]{8}/;
  if (!hexRegex.test(nodeId)) {
    if (nodeId.length <= 8) {
      return null;
    }

    // try to convert from integer to hex if provided
    nodeId = nodeId2hex(parseInt(nodeId));
  }

  if (nodeId.length !== 8) {
    return null;
  }

  return nodeId;
};

const fetchNodeId = (interaction: ChatInputCommandInteraction<CacheType>): string | null => {
  const mallaUrl = config.getMallaURL(interaction.guildId);

  let nodeId: string | null | undefined = interaction.options
    .getString("nodeid")?.replace(`https://${mallaUrl}/node/`, "")
    .replace("!", "")
    .trim();

  if (nodeId === undefined) {
    return null;
  }

  nodeId = validateNodeId(nodeId);
  if (nodeId === null) {
    return null;
  }

  return nodeId;
};

export { nodeId2hex, nodeHex2id, validateNodeId, fetchNodeId };
