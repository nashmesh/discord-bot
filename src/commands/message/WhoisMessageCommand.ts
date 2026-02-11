import { EmbedBuilder, Guild, Message, TextChannel, User, userMention } from "discord.js";
import CommandMessage from "./CommandMessage";
import { NodeSearchNodeResponse, searchNode } from "../../api/malla/Nodes";
import meshRedis from "../../MeshRedis";
import config from "Config";


export default class WhoisMessageCommand extends CommandMessage {

    constructor() {
        super("whois");
    }

    /** {@inheritdoc} */
    public async handle(guild: Guild | null, commandArgs: string[], message: Message): Promise<void> {
        if (guild === null) {
            return;
        }

        let channel: TextChannel = <TextChannel>message.channel;
        let nodeId = commandArgs[0] ?? undefined;

        if (nodeId === undefined) {
            await channel.send({
                content: "Usage: !whois <node_int_id|node_hex_id>",
            });
            return;
        }

        const response = await searchNode(nodeId);

        if (response === null || response === undefined) {
            await channel.send({
                content: "Error contacting Malla API",
            });
            return;
        }

        if (response === false) {
            await channel.send({
                content: "Node not found",
            });
            return;
        }

        let node: NodeSearchNodeResponse = response.nodes[0];
        let nodeOwner: string | null  = await meshRedis.getDiscordUserId(node.hex_id);
        let fields = [
                { name: 'Primary Channel',  value: node.primary_channel, inline: true },
                { name: 'Role',  value: node.role, inline: true },
                { name: 'Hardware Model',  value: node.hw_model },
                { name: 'Last Packet Time',  value: this.convertTimestampToDateTime(node.last_packet_time), inline: true },
                { name: 'Gateway Packet Count (24h)',  value: node.gateway_packet_count_24h.toString() },
                { name: 'Packet Count (24h)',  value: node.packet_count_24h.toString(), inline: true }
        ];

        if (nodeOwner) {
            const user: User = await guild.client.users.fetch(nodeOwner);

            fields.unshift(
                { name: 'Owner',  value: userMention(user.id), inline: true }
            );
        }

        const mallaUrl = config.getMallaURL(guild.id);
        let embed = (new EmbedBuilder())
            .setTitle(`${node.hex_id} (${node.long_name}) ${node.short_name}`)
            .setURL(`https://${mallaUrl}/node/${node.node_id}`)
            .addFields(fields)
            .setTimestamp(node.last_packet_time * 1000)
            .setColor(0x0099ff)

        await channel.send({ embeds: [embed] });

    }

    private convertTimestampToDateTime(timestamp: number): string {
        return (new Date(timestamp * 1000)).toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZoneName: 'short',
            timeZone: 'America/Chicago'
        });
    }
}