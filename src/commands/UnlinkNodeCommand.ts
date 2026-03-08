import { APIEmbedField, ChatInputCommandInteraction, EmbedBuilder, MessageFlags, userMention } from "discord.js";
import Command from "./Command";
import logger from "../Logger";
import meshDB from "../MeshDB";
import { NodeError } from "errors/NodeError";
import { Node } from "generated/prisma/client";

export default class UnlinkNodeCommand extends Command {

    constructor() {
        super("unlinknode");
    }

    public getHelpFields(): APIEmbedField[] {
        return [
            {
                name: 'Unlinking a node',
                value: '`/unlinknode nodeid`'
            },
                        {
                name: 'Example',
                value: '`/unlinknode 677d3afe`'
            },
        ];
    }

    public async handle(interaction: ChatInputCommandInteraction): Promise<void> {
        const nodeId = this.fetchNodeId(interaction);
        if (nodeId === null) {
            throw new NodeError({name: 'INVALID_NODE_PROVIDED'});
        }

        const node: Node | null = await this.getNode(nodeId);
        if (node === null) {
            throw new NodeError({name: 'NODE_NOT_FOUND'});
        }

        if (this.nodeHasOwner(node) === false) {
            throw new NodeError({name: 'NODE_IS_NOT_LINKED'});
        }

        if (this.nodeBelongsToUser(node, interaction) === false) {
            throw new NodeError({
                name: 'NODE_DOES_NOT_BELONG_TO_USER'
            });
        }

        await meshDB.client.node.update({
            data: {
                discordId: null
            },
            where: {
                hexId: nodeId
            }
        }).then(() => {
            const embed = new EmbedBuilder()
                .setTitle(`${node.longName ?? node.hexId} has been successfully unlinked!`)
                    .setAuthor({
                        name: interaction.user.displayName,
                        iconURL: interaction.user.avatarURL() ?? '',
                    })
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

            // maybe instead reset flags back to defaults
            meshDB.client.flag.deleteMany({
                where: {
                    node: {
                        hexId: nodeId
                    }
                }
            })
        });
    }
}