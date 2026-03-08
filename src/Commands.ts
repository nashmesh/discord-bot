import { ApplicationCommandOptionType } from "discord.js";
import LinkNodeCommand from "./commands/LinkNodeCommand";
import Command from "./commands/Command"
import UnlinkNodeCommand from "./commands/UnlinkNodeCommand";
import NodesCommand from "./commands/NodesCommand";
import CommandMessage from "./commands/message/CommandMessage";
import MqttCommand from "./commands/message/MqttCommand";
// import TestCommand from "./commands/TestCommand";
import WhoisCommand from "./commands/WhoisCommand";
import WhoisMessageCommand from "./commands/message/WhoisMessageCommand";
// import AnalyticsCommand from "./commands/AnalyticsCommand";
// import MallaCommand from "@commands/malla/MallaCommand";
// import PositionCommand from "@commands/PositionCommand";
import { Flags } from "Flags";
import FlagCommand from "@commands/FlagCommand";
import LinksMessageCommand from "@commands/message/LinksMessageCommand";

export type CommandType = {
  name: string;
  description: string;
  class: Command;
  options: OptionType[];
};

export type CommandMessageType = {
  name: string;
  description: string;
  class: CommandMessage;
};

export type OptionType = {
  name: string;
  type?: ApplicationCommandOptionType;
  description: string;
  required?: boolean;
  choices?: { name: string; value: string }[];
}

export const messageCommands: CommandMessageType[] = [
  {
    name: "mqtt",
    description: "View MQTT details",
    class: new MqttCommand
  },
  {
    name: "whois",
    description: "View information for a node that has been seen by an MQTT gateway",
    class: new WhoisMessageCommand
  },
  {
    name: "links",
    description: "Show all available link commands",
    class: new LinksMessageCommand
  }
];

export const commands: CommandType[] = [
  {
    name: "linknode",
    description: "Claim a node you own, and only ones you own, and link it to your discord",
    class: new LinkNodeCommand,
    options: [
      {
        name: "nodeid",
        type: ApplicationCommandOptionType.String,
        description: "Node ID must be hex-formatted. ex: `677d3afe`",
        required: true,
      },
    ],
  },
  {
    name: "unlinknode",
    description: "Unlink a node from your discord",
    class: new UnlinkNodeCommand,
    options: [
      {
        name: "nodeid",
        type: ApplicationCommandOptionType.String,
        description: "Node ID must be hex-formatted. ex: `677d3afe`",
        required: true,
      },
    ],
  },
  {
    name: "whois",
    description: "View information for a node that has been seen by an MQTT gateway",
    class: new WhoisCommand,
    options: [
      {
        name: "nodeid",
        type: ApplicationCommandOptionType.String,
        description: "The hex or integer node ID to view",
        required: true,
      },
    ],
  },
  {
    name: "nodes",
    description: "View information for a node that has been seen by an MQTT gateway",
    class: new NodesCommand,
    options: [
      {
        name: "user",
        type: ApplicationCommandOptionType.User,
        description: "The user to lookup nodes for",
        required: false,
      },
    ],
  },
  {
    name: "flags",
    description: "Set flags for your nodes",
    class: new FlagCommand,
    options: [
      {
        name: "nodeid",
        type: ApplicationCommandOptionType.String,
        description: "The hex or integer node ID to manage flags for",
        required: true,
      },
      {
        name: "command",
        type: ApplicationCommandOptionType.String,
        description: "The flag command to perform",
        required: true,
        choices: [
          {
            name: 'set',
            value: 'set'
          },
          {
            name: 'get',
            value: 'get'
          },
          {
            name: 'list',
            value: 'list'
          },
        ],
      },
      {
        name: "key",
        type: ApplicationCommandOptionType.String,
        description: "The flag key to manage",
        required: false,
        choices: Flags.getFlags().map((properties) => {
          return {
            name: properties.key,
            value: properties.key
          }
        })
      },
      {
        name: "value",
        type: ApplicationCommandOptionType.String,
        description: "The value for the flag key",
        required: false,
      },
    ],
  }
];

export function findClassForCommand(name: string): Command | null
{
    for (let command of commands) {
        if (command.name == name) {
            return command.class;
        }
    }

    return null;
}