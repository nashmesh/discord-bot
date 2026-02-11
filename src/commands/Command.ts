import { CacheType, ChatInputCommandInteraction, MessageFlags, userMention } from "discord.js";
import { fetchNodeId as _fetchNodeId } from "../NodeUtils";
import { Node } from "generated/prisma/client";
import meshDB from "MeshDB";

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
    return _fetchNodeId(interaction);
  };

  public async nodeBelongsToUser(nodeId: string, interaction: ChatInputCommandInteraction): Promise<boolean | null> {
    const node: Node | null = await meshDB.client.node.findFirst({
      where: {
        hexId: nodeId
      }
    })

    // node is not in DB
    if (!node) {
      return null;
    }

    if (node.discordId !== interaction.user.id) {
      await interaction.reply({
        content: `Node not found linked to ${userMention(interaction.user.id)}`,
        flags: MessageFlags.Ephemeral,
      });
      return false;
    }

    return true
  }

  protected async nodeHasOwner(nodeId: string): Promise<boolean> {
    const node: Node | null = await meshDB.client.node.findFirst({
      where: {
        hexId: nodeId
      }
    });

    if (!node) {
      return false;
    }

    return node.discordId !== null;
  }
}
