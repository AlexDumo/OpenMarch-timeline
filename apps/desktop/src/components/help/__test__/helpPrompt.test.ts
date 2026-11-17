import { describe, expect, it } from "vitest";
import { helpPrompt } from "../helpPrompt";

const base = {
    site: "https://openmarch.com",
    version: "0.2.0",
    app: "desktop",
    mode: "Basic",
    question: "",
} as const;

describe("helpPrompt", () => {
    it("points the assistant at the guide's plain-text copies on this build's site", () => {
        const prompt = helpPrompt(base);
        expect(prompt).toContain("https://openmarch.com/llms.txt");
        expect(prompt).toContain("plus .md");
        expect(prompt).toContain(
            "https://openmarch.com/guides/start/get-help/",
        );
    });

    it("says which app, version and mode the user is in", () => {
        const prompt = helpPrompt({ ...base, app: "web", mode: "Expert" });
        expect(prompt).toContain(
            "version 0.2.0, the web editor, in Expert mode",
        );
    });

    it("passes on the user's question", () => {
        const prompt = helpPrompt({
            ...base,
            question: "  How do I make marchers stand still?  ",
        });
        expect(prompt).toContain(
            "My question: How do I make marchers stand still?",
        );
        expect(prompt).not.toContain("asking me what I need help with");
    });

    it("asks the assistant to find out what the user needs when the box is empty", () => {
        for (const question of ["", "   "]) {
            const prompt = helpPrompt({ ...base, question });
            expect(prompt).toContain("asking me what I need help with");
            expect(prompt).not.toContain("My question:");
        }
    });

    it("uses the preview site for a pre-release build", () => {
        const prompt = helpPrompt({
            ...base,
            site: "https://preview.openmarch.com",
        });
        expect(prompt).toContain("https://preview.openmarch.com/llms.txt");
        expect(prompt).not.toContain("https://openmarch.com/");
    });
});
