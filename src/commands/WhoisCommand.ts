import { ChatInputCommandInteraction, MessageFlags, EmbedBuilder, User, userMention, time, APIEmbedField } from "discord.js";
import Command from "./Command";
import { NodeSearchNodeResponse, NodeSearchResponse, searchNode } from "../api/malla/Nodes";
import meshDB from "../MeshDB";
import logger from "../Logger";
import { validateNodeId } from "../NodeUtils";
import { Node } from "generated/prisma/client";
import config from "Config";
import { NodeError } from "errors/NodeError";

export default class WhoisCommand extends Command {

    constructor() {
        super("whois");
    }

    public getHelpFields(): APIEmbedField[] {
        return [
            {
                name: 'Perform a WHOIS on a node',
                value: '`/whois nodeId`'
            },
            {
                name: 'Example',
                value: '`/whois 677d3afe`'
            },
        ]
    }

    public async handle(interaction: ChatInputCommandInteraction): Promise<void> {
        const guild = interaction.guild;
        if (guild === null) return;

        const nodeId = this.fetchNodeId(interaction);
        if (nodeId === null) {
            throw new NodeError({name: 'INVALID_NODE_PROVIDED'});
        }

        const node: Node | null = await this.getNode(nodeId);
        if (node === null) {
            throw new NodeError({name: 'NODE_NOT_FOUND'});
        }

        const response = await this.performAPICall<NodeSearchResponse>(interaction, () => searchNode(node.hexId));
        const payload: NodeSearchNodeResponse = response.nodes[0] ?? null;

        if (payload === null) {
            throw new NodeError({name: 'NODE_NOT_FOUND'});
        }

        const fields: APIEmbedField[] = [
            { name: 'Primary Channel', value: payload.primary_channel, inline: true },
            { name: 'Role', value: payload.role, inline: true },
            { name: 'Hardware Model', value: payload.hw_model },
            { name: 'Last Packet Time', value: new Date(payload.last_packet_time * 1000).toISOString(), inline: true },
            { name: 'Gateway Packet Count (24h)', value: payload.gateway_packet_count_24h.toString() },
            { name: 'Packet Count (24h)', value: payload.packet_count_24h.toString(), inline: true }
        ];

        const nodeOwner = await this.getNodeOwner(payload.hex_id.replace('!', ''));
        if (nodeOwner !== null) {
            const user: User = await guild.client.users.fetch(nodeOwner);

            fields.unshift(
                { name: 'Owner', value: userMention(user.id), inline: true }
            );
        }

        const mallaUrl = config.getMallaURL(interaction.guildId);
        const embed = (new EmbedBuilder())
            .setTitle(`${payload.hex_id} (${payload.long_name}) ${payload.short_name}`)
            .setURL(`https://${mallaUrl}/node/${payload.node_id}`)
            .addFields(fields)
            .setTimestamp(payload.last_packet_time * 1000)
            .setColor(0x0099ff)

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    private async getNodeOwner(hexId: string): Promise<string | null> {
        const nodeId = validateNodeId(hexId);

        if (nodeId === null) {
            return null;
        }

        let node: Node | null = await meshDB.client.node.findFirst({
            where: {
                hexId: nodeId
            }
        });

        if (node && node.discordId) {
            return node.discordId;
        }

        return null;
    }
}