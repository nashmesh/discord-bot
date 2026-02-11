import { EmbedBuilder, Guild, Message, TextChannel } from "discord.js";
import CommandMessage from "./CommandMessage";

export default class MqttCommand extends CommandMessage {

    /** {@inheritdoc} */
    constructor() {
        super('mqtt');
    }


    /** {@inheritdoc} */
    public async handle(guild: Guild | null, commandArgs: string[], message: Message): Promise<void> {
        if (guild === null) {
            return;
        }

        let channel: TextChannel = <TextChannel>message.channel;

        let embed = (new EmbedBuilder())
            .setTitle('MQTT Details')
            .addFields(
                { name: 'MQTT Host', value: 'mqtt.nashme.sh', inline: true },
                { name: 'MQTT Username', value: 'meshdev', inline: true },
                { name: 'MQTT Password', value: 'large4cats', inline: true },
                { name: '`Primary` Channel Uplink', value: 'enabled' },
                { name: 'OK to MQTT', value: 'enabled' },
                { name: 'Topic', value: 'msh/US/TN/Middle', inline: true },
                { name: 'Read More', value: 'https://nashme.sh/mqtt', inline: true },
            );

        await channel.send({ embeds: [embed] });
    }
}