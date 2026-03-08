import { FlagValue } from "Flags";
import { Flag, Node } from "generated/prisma/client";
import meshDB from "MeshDB";

export class FlagRepository {

       public static async setFlag(node: Node, key: string, value: FlagValue): Promise<Flag> {
            return await meshDB.client.flag.upsert({
                update: {
                    value: value,
                },
                create: {
                    key: key,
                    value: value,
                    nodeId: node.id
                },
                where: {
                    nodeId_key: {
                        nodeId: node.id,
                        key: key
                    }
                }
            });
        }

        public static async getFlag(node: Node, key: string): Promise<Flag | null> {
            const flag: Flag | null = await meshDB.client.flag.findFirst({
                where: {
                    nodeId: node.id,
                    key: key
                }
            })

            if (!flag) {
                return null;
            }

            return flag;
        }

        public static async getFlags(node: Node): Promise<Flag[]> {
            return await meshDB.client.flag.findMany({
                where: {
                    nodeId: node.id
                }
            })
        }
}