export class DiscordError extends Error {};

export function createErrorClass<T extends Record<string, string>>(errorTypes: T) {
    return class extends DiscordError {
        name: keyof T & string;
        message: string;
        cause: any;

        constructor({
            name,
            cause,
        }: {
            name: keyof T & string;
            cause?: any;
        }) {
            const message = errorTypes[name];
            super(message);
            this.name = name;
            this.message = message;
            this.cause = cause;
        }
    };
}