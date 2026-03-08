import { ChatInputCommandInteraction, CacheType, MessageFlags, EmbedAuthorOptions, RestOrArray, APIEmbedField } from "discord.js";
import { nodeHex2id} from "../NodeUtils";
import Command from "./Command";
import meshDB from "MeshDB";
import { Pagination } from "pagination.djs";
import config from "Config";
import { NodeError } from "errors/NodeError";

export default class NodesCommand extends Command {

    constructor() {
        super("nodes");
    }

    public getHelpFields(): APIEmbedField[] {
        return [
            {
                name: 'List nodes linked to yourself',
                value: '`/nodes`'
            },
            {
                name: 'List nodes linked to another user',
                value: '`/nodes user`'
            },
            {
                name: 'Example',
                value: '`/nodes @M3shHe4d`'
            },
        ]
    }

    public async handle(interaction: ChatInputCommandInteraction<CacheType>): Promise<void> {
        let userArg = interaction.options.getUser('user');

        if (userArg === null) {
            userArg = interaction.user;
        }

        meshDB.client.node.findMany({
            where: {
                discordId: userArg.id
            }
        }).then((nodes) => {
            if (nodes.length === 0) {
                throw new NodeError({name: 'USER_HAS_NO_NODES'});
            }

            const mallaUrl = config.getMallaURL(interaction.guildId);
            const fields = [] as APIEmbedField[];
            nodes.forEach(node => {
                fields.push({
                    name: `[!${node.hexId}] ${node.longName ?? 'Unknown'}`,
                    value: `[View on Malla](https://${mallaUrl}/node/${nodeHex2id(node.hexId)})`
                })
            });

            const authorOptions: EmbedAuthorOptions = {
                name: userArg.displayName,
                iconURL: userArg.displayAvatarURL().toString()
            };

            const pagination = new Pagination(interaction);
            pagination.setFields(fields);
            pagination.setTitle('Linked Nodes')
            pagination.setAuthor(authorOptions)
            pagination.setEphemeral(true);
            pagination.paginateFields();
            pagination.render();
        })
    }
}