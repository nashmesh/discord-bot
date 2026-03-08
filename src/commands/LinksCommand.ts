import { ChatInputCommandInteraction, CacheType, MessageFlags, userMention } from "discord.js";
import Command from "./Command";
import logger from "../Logger";
import { fetchNodeId } from "../NodeUtils";
import meshDB from "../MeshDB";

export default class LinksCommand extends Command {

    constructor() {
        super("links");
    }

    public async handle(interaction: ChatInputCommandInteraction<CacheType>): Promise<void> {
        const option = interaction.options.getString('option');
        const link = interaction.options.getString('link');
        const value = interaction.options.getString('value');
        // await this.handleOption(option, link, value, interaction);
    }

    private async handleOption(command: string, link: string, value: string, interaction: ChatInputCommandInteraction): Promise<void> {

    }
}