import { createErrorClass, DiscordError } from "./error";

export const NodeErrorTypes = {
    INVALID_NODE_LENGTH: "Node ID must be hex-formatted. ex: `677d3afe`",
    INVALID_NODE_PROVIDED: "Node ID must be hex-formatted. ex: `677d3afe`",
    INVALID_NODE_TYPE: "Node type is not recognized.",
    NODE_NOT_FOUND: "The node ID provided was not found in the database.",
    NODE_DOES_NOT_BELONG_TO_USER: "This node belongs to another account.",
    NODE_IS_ALREADY_LINKED: "This node is already linked to an account.",
    NODE_IS_ALREADY_LINKED_TO_USER: "This node is already linked to your account.",
    NODE_IS_NOT_LINKED: "This node is currently not linked to anyone.",
    USER_HAS_NO_NODES: "No nodes found for this user"
} as const;

export const NodeError = createErrorClass(NodeErrorTypes);
export type NodeError = InstanceType<typeof NodeError>;