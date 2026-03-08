import { createErrorClass } from "errors/error";

export const FlagErrorTypes = {
    COMMAND_NOT_FOUND: "Command not found.",
    NO_COMMAND_PROVIDED: "Please provide a command to perform.",
    NO_COMMAND_KEY_PROVIDED: "Please provide a command-key to perform.",
    NODE_NOT_SEEN_BY_MQTT: "This node has not been seen yet by an MQTT gateway node",
    NODE_NOT_LINKED: "This node is not linked to anyone. If you own this node, use the `/linknode <nodeId>` command",
    NODE_DOES_NOT_BELONG_TO_USER: "This node is linked to someone else."
} as const;

export const FlagError = createErrorClass(FlagErrorTypes);
export type FlagError = InstanceType<typeof FlagError>;