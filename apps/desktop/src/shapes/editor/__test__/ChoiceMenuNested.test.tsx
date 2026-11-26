import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { ChoiceMenu } from "../ChoiceMenu";
import { useEditorMenu } from "../menuFocus";
import type { ToolChoice, ToolEnv } from "../../tool/toolKind";

/**
 * A choice menu nested in another of the editor's menus (the Rows menu's "Rows go", #1193): the
 * outer menu stays open, so closing the nested one from the keyboard hands focus back to its own
 * button rather than dropping it, where Enter would reach the app and place the open shape
 */

const env = { stepPx: 10 } as ToolEnv;

const choice: ToolChoice<{ go: string }> = {
    key: "rowsGo",
    label: "Rows go",
    tip: "Which way each row steps from the line you drew",
    options: () => [
        { value: "slide", label: "Out from the line", detail: "Square" },
        { value: "back", label: "Front to back", detail: "Straight back" },
    ],
    current: (p) => p.go,
    pick: (_p, _n, value) => ({ go: value }),
};

/** The outer menu: open, holding the editor's one open menu */
function Outer({ apply }: { apply: (next: unknown) => void }) {
    const [, setOpen] = useEditorMenu();
    useEffect(() => setOpen(true), []);
    return (
        <ChoiceMenu
            choice={choice}
            target={{ params: { go: "slide" }, spots: 4, apply }}
            envFor={() => env}
            nested
        />
    );
}

afterEach(cleanup);

describe("a nested choice menu", () => {
    it("hands focus back to its button when an answer is picked from the keyboard", async () => {
        const apply = vi.fn();
        const { getByTestId, findByTestId } = render(<Outer apply={apply} />);
        const button = getByTestId("shape-choice-rowsGo");
        button.focus();
        fireEvent.keyDown(button, { key: "Enter" });
        fireEvent.click(button);
        const option = await findByTestId("shape-choice-rowsGo-back");
        fireEvent.keyDown(option, { key: "Enter" });
        fireEvent.click(option);
        expect(apply).toHaveBeenCalledWith({ go: "back" });
        await waitFor(() => expect(document.activeElement).toBe(button));
    });

    it("hands focus back to its button on Escape", async () => {
        const { getByTestId, findByTestId } = render(
            <Outer apply={() => {}} />,
        );
        const button = getByTestId("shape-choice-rowsGo");
        button.focus();
        fireEvent.keyDown(button, { key: "Enter" });
        fireEvent.click(button);
        const content = await findByTestId("shape-choice-rowsGo-content");
        fireEvent.keyDown(content, { key: "Escape" });
        await waitFor(() => expect(document.activeElement).toBe(button));
    });
});
