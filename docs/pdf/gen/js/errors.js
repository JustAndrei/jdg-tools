export const GENERIC_ERROR_MESSAGE = 'Упс! Что-то пошло не так :-(';

/**
 * An error with two audiences: `message` is the technical detail for the console,
 * `userMessage` is what the person sees on the page.
 */
export class AppError extends Error {
    constructor(detail, userMessage = GENERIC_ERROR_MESSAGE) {
        super(detail);
        this.name = 'AppError';
        this.userMessage = userMessage;
    }
}

export function userMessageFor(error) {
    return error instanceof AppError ? error.userMessage : GENERIC_ERROR_MESSAGE;
}
