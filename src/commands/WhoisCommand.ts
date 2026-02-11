import { ChatInputCommandInteraction, MessageFlags, EmbedBuilder, User, userMention, time } from "discord.js";
import Command from "./Command";
import { NodeSearchNodeResponse, NodeSearchResponse, searchNode } from "../api/malla/Nodes";
import meshDB from "../MeshDB";
import logger from "../Logger";
import { validateNodeId } from "../NodeUtils";
import { Node } from "generated/prisma/client";
import config from "Config";

export default class WhoisCommand extends Command {

    constructor() {
        super("whois");
    }

    public async handle(interaction: ChatInputCommandInteraction): Promise<void> {
        const nodeId = this.fetchNodeId(interaction);

        if (nodeId === null) {
            return;
        }

        const response = await this.performAPICall<NodeSearchResponse>(interaction, () => searchNode(nodeId));
        const node: NodeSearchNodeResponse = response.nodes[0] ?? null;

        if (node === null) {
            await interaction.reply({
                content: 'Node not found',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const fields = [
            { name: 'Primary Channel', value: node.primary_channel, inline: true },
            { name: 'Role', value: node.role, inline: true },
            { name: 'Hardware Model', value: node.hw_model },
            { name: 'Last Packet Time', value: new Date(node.last_packet_time * 1000).toISOString(), inline: true },
            { name: 'Gateway Packet Count (24h)', value: node.gateway_packet_count_24h.toString() },
            { name: 'Packet Count (24h)', value: node.packet_count_24h.toString(), inline: true }
        ];

        const nodeOwner = await this.getNodeOwner(node.hex_id.replace('!', ''));
        if (nodeOwner) {
            const user: User = await interaction.guild.client.users.fetch(nodeOwner);

            fields.unshift(
                { name: 'Owner', value: userMention(user.id), inline: true }
            );
        }

        const mallaUrl = config.getMallaURL(interaction.guildId);
        const embed = (new EmbedBuilder())
            .setTitle(`${node.hex_id} (${node.long_name}) ${node.short_name}`)
            .setURL(`https://${mallaUrl}/node/${node.node_id}`)
            .addFields(fields)
            .setTimestamp(node.last_packet_time * 1000)
            .setColor(0x0099ff)

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    private async getNodeOwner(hexId: string): Promise<string | null> {
        const nodeId = validateNodeId(hexId);
        logger.info(nodeId);

        if (nodeId === null) {
            return null;
        }

        // try redis first until we've moved everything over to the DB
        // let payload = { discordId: await meshRedis.getDiscordUserId(nodeId) };
        // if (payload && payload.discordId) {
        //     return payload.discordId;
        // }

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
}