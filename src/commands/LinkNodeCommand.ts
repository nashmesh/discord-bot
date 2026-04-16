import { ChatInputCommandInteraction, CacheType, MessageFlags, userMention, APIEmbedField, EmbedBuilder } from "discord.js";
import Command from "./Command";
import logger from "../Logger";
import meshDB from "../MeshDB";
import { NodeError } from "errors/NodeError";
import { Node } from "generated/prisma/client";
import { nodeHex2id } from "NodeUtils";

export default class LinkNodeCommand extends Command {

    constructor() {
        super("linknode");
    }

    public getHelpFields(): APIEmbedField[] {
        return [
            {
                name: 'Linking a node',
                value: '`/linknode nodeid`'
            },
                        {
                name: 'Example',
                value: '`/linknode 677d3afe`'
            },
        ];
    }

    public async handle(interaction: ChatInputCommandInteraction<CacheType>): Promise<void> {
        const nodeId = this.fetchNodeId(interaction);
        if (nodeId === null) {
            throw new NodeError({name: 'INVALID_NODE_PROVIDED'});
        }

        const node: Node | null = await this.getNode(nodeId);
        if (node === null) {
            throw new NodeError({name: 'NODE_NOT_FOUND'});
        }

        if (this.nodeHasOwner(node) === true) {
            if (this.nodeBelongsToUser(node, interaction) === true) {
                throw new NodeError({
                    name: 'NODE_IS_ALREADY_LINKED_TO_USER'
                });
            }

            throw new NodeError({name: 'NODE_IS_ALREADY_LINKED'});
        }

        const isMeshcore = nodeId.length === 64;

        await meshDB.client.node.upsert({
            update: {
                discordId: {
                    set: interaction.user.id,
                }
            },
            create: {
                discordId: interaction.user.id,
                hexId: nodeId,
                platform: isMeshcore ? 'meshcore' : 'meshtastic',
            },
            where: {
                hexId: nodeId
            }
        }).then((node: Node) => {
            const fields = isMeshcore ? [
                {
                    name: "Analyzer",
                    value: `Check out your node on the [NashMe.sh Analyzer](https://analyzer.nashme.sh/#/nodes/${node.hexId}).`,
                    inline: true
                },
                {
                    name: "Flags",
                    value: 'Check out `/help flags` to set flags for your node.',
                    inline: true
                },
            ] : [
                {
                    name: "Malla",
                    value: `Check out metrics and more for your node on our [Malla](https://malla.nashme.sh/node/${nodeHex2id(node.hexId)}).`,
                    inline: true
                },
                {
                    name: "Potato",
                    value: `Check to see if your node has been seen on our [Potato map](https://potato.nashme.sh/nodes/!${node.hexId}).`,
                    inline: true
                },
                {
                    name: "Flags",
                    value: 'Check out `/help flags` to set flags for your node.',
                    inline: true
                },
            ];

            const embed = new EmbedBuilder()
                .setTitle(`${node.longName ?? node.hexId} has been successfully linked!`)
                .setAuthor({
                    name: interaction.user.displayName,
                    iconURL: interaction.user.avatarURL() ?? '',
                })
                .addFields(...fields)
                .setColor("#fefdf5")
                .setFooter({
                    text: "NashMesh",
                    iconURL: "https://nashme.sh/static/images/logo.png",
                })
                .setTimestamp();

            interaction.reply({
                embeds: [embed],
                flags: MessageFlags.Ephemeral,
            });
        });
    }
}