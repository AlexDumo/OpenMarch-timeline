/**
 * The prompt Help › Ask an AI assistant copies, for the user to paste into ChatGPT, Claude or
 * any other assistant. It points the assistant at the user guide's plain-text copies
 * (`llms.txt`, and each page's address plus `.md`), says which app the user is in, and either
 * passes on the user's question or asks the assistant to find out what they need first.
 *
 * The prompt is for the assistant, not the user, so it stays in English (assistants answer in
 * the language the user writes to them in).
 */
export interface HelpPromptContext {
    /** The guide's site, such as https://openmarch.com */
    readonly site: string;
    readonly version: string;
    readonly app: "desktop" | "web";
    readonly mode: "Basic" | "Expert";
    /** What the user typed; empty when they left the box blank */
    readonly question: string;
}

export function helpPrompt(ctx: HelpPromptContext): string {
    const question = ctx.question.trim();
    // i18n-ignore: a prompt for an AI assistant, kept in English on purpose
    const app = ctx.app === "web" ? "the web editor" : "the desktop app";
    // i18n-ignore: a prompt for an AI assistant, kept in English on purpose
    return [
        `I'm using OpenMarch, free drill-writing software for marching bands: version ${ctx.version}, ${app}, in ${ctx.mode} mode.`,
        "",
        `Its user guide has a version for assistants like you. ${ctx.site}/llms.txt lists every page, and each page has a plain-text copy at its address plus .md (for example ${ctx.site}/guides/timeline/moves.md). Read the pages you need before you answer, and don't guess at buttons, menus or shortcuts the guide doesn't name.`,
        "",
        question
            ? `My question: ${question}`
            : "I haven't asked my question yet. Start by asking me what I need help with.",
        "",
        `Answer in short numbered steps that name the buttons, menus and shortcuts to use, and link the guide page you used. If the guide doesn't cover it, say so, and point me to ${ctx.site}/guides/start/get-help/.`,
    ].join("\n");
}
