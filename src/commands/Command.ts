import { APIEmbedField, CacheType, ChatInputCommandInteraction, MessageFlags, userMention } from "discord.js";
import { fetchNodeId as _fetchNodeId, validateNodeId } from "../NodeUtils";
import { Node } from "generated/prisma/client";
import meshDB from "MeshDB";
import { NodeError } from "errors/NodeError";
import config from "Config";

export default abstract class Command {
  protected name: string;

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Handle a guild command interaction.
   * @async
   * @param interaction
   */
  abstract handle(interaction: ChatInputCommandInteraction): Promise<void>;

  /**
   * The help
   *
   * @returns
   */
  public getHelpFields(): APIEmbedField[] {
    return [];
  }

  /**
   * Fetch an API call using a callback. If the API request fails, the interaction is replied back
   * with an error.
   * @param interaction
   * @param callback
   * @returns
   */
  public async performAPICall<T>(interaction: ChatInputCommandInteraction, callback: () => Promise<T>): Promise<T> {
    try {
      return await callback() as T;
    } catch (error) {
      if (error instanceof Error) {
        await interaction.reply({
          content: error.message,
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: 'An unknown error has occured',
          flags: MessageFlags.Ephemeral,
        });
      }

      return {} as T;
    }
  }

  public fetchNodeId(interaction: ChatInputCommandInteraction<CacheType>): string | null {
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
      return null
    }

    return nodeId;
  };

  /**
   * Does a node belong to a user?
   *
   * @param node
   * @param interaction
   * @returns
   */
  public nodeBelongsToUser(node: Node, interaction: ChatInputCommandInteraction): boolean {
    return node.discordId === interaction.user.id;
  }

  /**
   * Does a node have an owner?
   *
   * @param node
   * @returns
   */
  public nodeHasOwner(node: Node): boolean {
    return node.discordId !== null;
  }

  /**
   * Does the node exist in the DB?
   *
   * @param nodeId
   * @returns
   */
  protected async nodeExists(nodeId: string): Promise<boolean>
  {
    return await this.getNode(nodeId) !== null;
  }

  /**
   * Get a node from the DB
   *
   * @param nodeId
   * @returns
   */
  protected async getNode(nodeId: string): Promise<Node | null> {
    return await meshDB.client.node.findFirst({
      where: {
        hexId: nodeId
      }
    });
  }
}
