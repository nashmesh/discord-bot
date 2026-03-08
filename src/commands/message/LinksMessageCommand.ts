import { APIEmbedField, Guild, Message } from "discord.js";
import CommandMessage from "./CommandMessage";
import meshDB from "MeshDB";
import { Pagination } from "pagination.djs";

export default class LinksMessageCommand extends CommandMessage {

    /** {@inheritdoc} */
    constructor() {
        super('links');
    }


    /** {@inheritdoc} */
    public async handle(guild: Guild | null, commandArgs: string[], message: Message): Promise<void> {
        if (guild === null) {
            return;
        }

        const links = await meshDB.client.links.findMany({
            distinct: ['type'],
            select: {
                type: true,
            }
        });

        const fields = [] as APIEmbedField[];
        links.forEach((link) => {
            fields.push({
                name: `!${link.type}`,
                value: '',
            })
        })

        const pagination = new Pagination(message);
        pagination.setFields(fields);
        pagination.setTitle('Available Links')
        pagination.paginateFields();
        pagination.render();
    }
}