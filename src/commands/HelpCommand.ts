import { ChatInputCommandInteraction, CacheType, MessageFlags, userMention, APIEmbedField } from "discord.js";
import Command from "./Command";
import { findClassForCommand } from "Commands";
import { Pagination } from "pagination.djs";

export default class HelpCommand extends Command {

    constructor() {
        super("help");
    }

    public async handle(interaction: ChatInputCommandInteraction<CacheType>): Promise<void> {
        const command = interaction.options.getString('command')?.toLowerCase();

        if (command === undefined) {
            await interaction.reply({
                content: 'To view help for a specific command, try `/helps command`',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const commandClass = findClassForCommand(command);
        if (commandClass === null) {
            await interaction.reply({
                content: 'To view help for a specific command, try `/helps command`',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const fields: APIEmbedField[] = commandClass.getHelpFields();

        const pagination = new Pagination(interaction);
        pagination.setFields(fields);
        pagination.setTitle(`Help Guide: /${command}`);
        pagination.paginateFields();
        pagination.render();
    }
}