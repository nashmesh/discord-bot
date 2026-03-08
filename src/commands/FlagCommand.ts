import { APIEmbedField, ChatInputCommandInteraction, MessageFlags } from "discord.js";
import Command from "@commands/Command";
import meshDB from "MeshDB";
import { Flag, Node } from "generated/prisma/client";
import { FlagProperties, Flags, FlagValue } from "Flags";
import { FlagRepository } from "@repositories/FlagRepository";
import { FlagError } from "./errors/FlagError";
import { NodeError } from "errors/NodeError";
import { Pagination } from "pagination.djs";
import logger from "Logger";

const typeMap: { [key: string]: any } = {
    'boolean': Boolean,
    'string': String,
    'number': Number
}

type CommandConfiguration = {
    callback: (node: Node, key: string | null, interaction: ChatInputCommandInteraction) => Promise<void>;
    requiresKey: boolean;
    requiresValue: boolean;
};

export default class FlagCommand extends Command {

    static commands: { [key: string]: CommandConfiguration } = {
        'set': {
            requiresKey: true,
            requiresValue: true,
            callback: this.setCommand,
        },
        'get': {
            requiresKey: true,
            requiresValue: false,
            callback: this.getCommand,
        },
        'list': {
            requiresKey: false,
            requiresValue: false,
            callback: this.listCommand
        },
        // 'listCommands': {
        //     requiresKey: false,
        //     requiresValue: false,
        //     callback: this.listCommandsCommand
        // }
    };

    constructor() {
        super("flag");
    }

    public getHelpFields(): APIEmbedField[] {
        return [
            {
                name: 'Available Flags',
                value: '`showPosition`'
            },
            {
                name: 'List flags for a node',
                value: '`/flags nodeid list`'
            },
            {
                name: 'Example',
                value: '`/flags 677d3afe list`'
            },
            {
                name: 'Set flag on node',
                value: '`/flags nodeid set key value`'
            },
            {
                name: 'Example',
                value: '`/flags 677d3afe set showPosition true`'
            },
            {
                name: 'Get the current flag on node',
                value: '`/flags nodeid get key`'
            },
            {
                name: 'Example',
                value: '`/flags 677d3afe get showPosition`'
            },
        ]
    }

    public async handle(interaction: ChatInputCommandInteraction): Promise<void> {
        const command = interaction.options.getString('command');
        if (command === null) {
            throw new FlagError({name: 'NO_COMMAND_PROVIDED'});
        }

        const commandConfiguration = FlagCommand.commands[command];
        if (commandConfiguration === null) {
            throw new FlagError({name: 'COMMAND_NOT_FOUND'});
        }

        const key = interaction.options.getString('key');
        if (key === null && commandConfiguration.requiresKey === true) {
            throw new FlagError({name: 'NO_COMMAND_KEY_PROVIDED'});
        }

        const nodeId = this.fetchNodeId(interaction);
        if (nodeId === null) {
            throw new NodeError({name: 'INVALID_NODE_PROVIDED'});
        }

        const node = await FlagCommand.getNodeForUser(nodeId, interaction);
        if (this.nodeHasOwner(node) === false) {
            throw new NodeError({name: 'NODE_IS_NOT_LINKED'});
        }

        if (this.nodeBelongsToUser(node, interaction) === false) {
            throw new NodeError({
                name: 'NODE_DOES_NOT_BELONG_TO_USER'
            });
        }

        await commandConfiguration.callback(node, key, interaction);
    }

    // private static async listCommandsCommand(node: Node, key: string | null, interaction: ChatInputCommandInteraction): Promise<void> {
    //     const fields = [] as APIEmbedField[];

    //     for (const [key] of Object.entries(FlagCommand.commands)) {
    //         fields.push({
    //             name: key,
    //             value: key,
    //         });
    //     }

    //     const pagination = new Pagination(interaction);
    //     pagination.setFields(fields);
    //     pagination.setTitle('Flags')
    //     pagination.paginateFields();
    //     pagination.setEphemeral(true);
    //     pagination.render();
    // }

    private static async listCommand(node: Node, key: string | null, interaction: ChatInputCommandInteraction): Promise<void> {
        const fields = [] as APIEmbedField[];

        let values: {[key: string]: any} = {};
        Flags.getFlags().forEach((properties) => {
            values[properties.key] = properties.default;
        });

        let currentValues: {[key: string]: any} = {};
        (await FlagRepository.getFlags(node)).forEach((flag) => {
            currentValues[flag.key] = flag.value;
        })

        for (const [key, value] of Object.entries(values)) {
            fields.push({
                name: key,
                value: currentValues[key] ?? value,
            });
        }

        const pagination = new Pagination(interaction);
        pagination.setFields(fields);
        pagination.setTitle('Flags')
        pagination.paginateFields();
        pagination.setEphemeral(true);
        pagination.render();
    }

    /**
     * `set` command handler
     * @param nodeId
     * @param interaction
     * @returns
     */
    private static async setCommand(node: Node, key: string | null, interaction: ChatInputCommandInteraction): Promise<void> {
        key = key as string;

        let value: FlagValue | null = null;

        try {
            value = <FlagValue>(interaction.options.get('value', true)).value;
        } catch (error) {
            await interaction.reply({ content: `:flag_white: Please provide a \`value\``, flags: MessageFlags.Ephemeral });
            return;
        }

        // get flag properties if they exist
        const flagProperties: FlagProperties | undefined = Flags.getFlagProperties(key);
        if (flagProperties === undefined) {
            await interaction.reply({ content: `:flag_white: Flag \'${key}\' does not exist`, flags: MessageFlags.Ephemeral });
            return;
        }

        const type = typeMap[flagProperties.type]

        // convert to type defined by flag
        switch (type) {
            case Boolean:
                value = value.toString().toLowerCase();

                if (value !== 'false' && value !== 'true') {
                    await interaction.reply({ content: `:flag_white: \`${key}\` must be either \`true\` or \`false\``, flags: MessageFlags.Ephemeral });
                    return;
                }

                value = value === 'true';
                break;
            case Number:
                value = Number(value);
                break;
        }

        // one final type check
        if (typeof value !== flagProperties.type) {
            await interaction.reply({ content: `:flag_white: \`${key}\` must be of type \`${flagProperties.type}\``, flags: MessageFlags.Ephemeral });
            return;
        }

        // is the value different from the current value set, if one already exists
        const flag: Flag | null = await FlagRepository.getFlag(node, key);
        if (flag && flag.value === value) {
            await interaction.reply({ content: `:flag_white: \`${key}\` **is already set to** \`${value.toString()}\` **for** \`!${node.hexId}\``, flags: MessageFlags.Ephemeral });
            return;
        }

        // add flag to node with key and value
        await FlagRepository.setFlag(node, key, value);

        await interaction.reply({ content: `:flag_white: \`${key}\` **is now set to** \`${value.toString()}\` **for** \`!${node.hexId}\``, flags: MessageFlags.Ephemeral });
    }

    /**
     * `get` command handler
     * @param nodeId
     * @param interaction
     * @returns
     */
    private static async getCommand(node: Node, key: string | null, interaction: ChatInputCommandInteraction): Promise<void> {
        key = key as string;

        const flagProperties: FlagProperties | undefined = Flags.getFlagProperties(key);

        if (flagProperties === undefined) {
            await interaction.reply({ content: `:flag_white: Flag \'${key}\' does not exist`, flags: MessageFlags.Ephemeral });
            return;
        }

        const flag = await FlagRepository.getFlag(node, key);
        if (flag === null) {
            await interaction.reply({ content: `:flag_white: \`${key}\` **is currently set to** \`${flagProperties.default?.toString()}\` **for** \`!${node.hexId}\``, flags: MessageFlags.Ephemeral });
            return;
        }

        let value = flag.value;
        const type = typeMap[flagProperties.type]

        if (value === null || typeof value !== flagProperties.type) {
            return;
        }

        switch (type) {
            case Boolean:
                value = value.toString().toLowerCase();

                value = value === 'true';
                break;
            case Number:
                value = Number(value)
                break;
        }

        await interaction.reply({ content: `:flag_white: \`${key}\` **is currently set to** \`${value.toString()}\` **for** \`!${node.hexId}\``, flags: MessageFlags.Ephemeral });
    }

    private static async getNodeForUser(nodeId: string, interaction: ChatInputCommandInteraction): Promise<Node> {
        const node = await meshDB.client.node.findFirst({
            where: {
                hexId: nodeId
            }
        });

        if (node === null) {
            throw new FlagError({name: 'NODE_NOT_SEEN_BY_MQTT'});
        }

        // @todo
        if (node.discordId === null) {
            throw new FlagError({name: 'NODE_NOT_LINKED'});
        }

        if (node.discordId !== interaction.user.id) {
            throw new FlagError({name: 'NODE_DOES_NOT_BELONG_TO_USER'});
        }

        return node;
    }
}


