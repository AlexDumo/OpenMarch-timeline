import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import * as Form from "@radix-ui/react-form";
import { Tabs } from "@openmarch/ui";
import { Checkpoint, FieldProperties } from "@openmarch/core";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import { CheckpointEditor } from "../CheckpointEditor";
import { CheckpointsTab } from "../CheckpointsTab";
import { GeneralTab } from "../GeneralTab";

const template =
    FieldPropertiesTemplates.HIGH_SCHOOL_FOOTBALL_FIELD_NO_END_ZONES;

beforeEach(() => {
    // Radix measures the select and switches
    vi.stubGlobal(
        "ResizeObserver",
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
        },
    );
});

/** The customizer's tabs need a form and a tab list around them. */
const inTab = (tab: string, children: React.ReactNode) => (
    <Form.Root>
        <Tabs value={tab}>{children}</Tabs>
    </Form.Root>
);

describe("CheckpointEditor", () => {
    const fortyFive: Checkpoint = {
        id: 7,
        name: "45 yard line",
        terseName: "45",
        axis: "x",
        stepsFromCenterFront: -8,
        useAsReference: true,
        visible: true,
        fieldLabel: "45",
    };
    const editor = (checkpoint: Checkpoint, updateCheckpoint = vi.fn()) => (
        <Form.Root>
            <CheckpointEditor
                checkpoint={checkpoint}
                axis="x"
                updateCheckpoint={updateCheckpoint}
                deleteCheckpoint={vi.fn()}
            />
        </Form.Root>
    );
    const open = () => fireEvent.click(screen.getByText("45 yard line"));

    it("shows the stored values again after they change outside the panel (undo, import)", () => {
        const { rerender } = render(editor(fortyFive));
        open();
        expect(screen.getByLabelText("Name")).toHaveValue("45 yard line");

        rerender(
            editor({
                ...fortyFive,
                name: "Forty-five",
                terseName: "F5",
                stepsFromCenterFront: -9,
                fieldLabel: "4.5",
            }),
        );
        expect(screen.getByLabelText("Name")).toHaveValue("Forty-five");
        expect(screen.getByLabelText("Short Name")).toHaveValue("F5");
        expect(screen.getByLabelText("Steps from center")).toHaveValue("-9");
        expect(screen.getByLabelText("Field label")).toHaveValue("4.5");
    });

    it("writes nothing when an untouched input is blurred", () => {
        const update = vi.fn();
        render(editor(fortyFive, update));
        open();
        for (const label of [
            "Name",
            "Short Name",
            "Steps from center",
            "Field label",
        ])
            fireEvent.blur(screen.getByLabelText(label));
        expect(update).not.toHaveBeenCalled();
    });

    it("saves a changed value on blur", () => {
        const update = vi.fn();
        render(editor(fortyFive, update));
        open();
        const steps = screen.getByLabelText("Steps from center");
        fireEvent.change(steps, { target: { value: "-10" } });
        fireEvent.blur(steps);
        expect(update).toHaveBeenCalledWith({
            axis: "x",
            oldCheckpoint: fortyFive,
            newCheckpoint: { ...fortyFive, stepsFromCenterFront: -10 },
        });
    });
});

describe("CheckpointsTab", () => {
    it("lists checkpoints in step order without sorting the stored lists", () => {
        const shuffled = [...template.xCheckpoints].reverse();
        const field = new FieldProperties({
            ...template,
            xCheckpoints: Object.freeze(shuffled) as Checkpoint[],
            yCheckpoints: Object.freeze([
                ...template.yCheckpoints,
            ]) as Checkpoint[],
        });
        const before = field.xCheckpoints.map((c) => c.id);
        // A sort in place would throw on the frozen lists
        render(
            inTab(
                "checkpoints",
                <CheckpointsTab
                    currentFieldProperties={field}
                    updateFieldProperties={vi.fn()}
                    updateCheckpoint={vi.fn()}
                    deleteCheckpoint={vi.fn()}
                    addCheckpoint={vi.fn()}
                />,
            ),
        );
        expect(field.xCheckpoints.map((c) => c.id)).toEqual(before);
        const shown = screen
            .getAllByText(/^\d+ yard line$/)
            .map((el) => el.textContent);
        // Side 1's 0 yard line first, through the 50, to side 2's 0
        expect(shown[0]).toBe("0 yard line");
        expect(shown[10]).toBe("50 yard line");
    });
});

describe("GeneralTab", () => {
    const general = (field: FieldProperties, update = vi.fn()) =>
        inTab(
            "general",
            <GeneralTab
                currentFieldProperties={field}
                updateFieldProperties={update}
            />,
        );

    it("shows the stored values again after they change outside the panel", () => {
        const { rerender } = render(general(template));
        expect(screen.getByLabelText("Field Name")).toHaveValue(template.name);

        const changed = new FieldProperties({
            ...template,
            name: "Home stadium",
            stepSizeInches: 30,
            halfLineXInterval: 4,
            sideDescriptions: {
                ...template.sideDescriptions,
                terseLeft: "L",
            },
        });
        rerender(general(changed));
        expect(screen.getByLabelText("Field Name")).toHaveValue("Home stadium");
        expect(screen.getByLabelText("Step Size")).toHaveValue("30");
        expect(screen.getByLabelText("Half Line X-Interval")).toHaveValue("4");
        expect(screen.getByLabelText("Left Abbreviation")).toHaveValue("L");
    });

    it("writes nothing when untouched inputs are blurred", () => {
        const update = vi.fn();
        render(general(template, update));
        for (const input of screen.getAllByRole("textbox"))
            fireEvent.blur(input);
        expect(update).not.toHaveBeenCalled();
    });

    it("doesn't save a step size of 0, and shows the stored one again", () => {
        const update = vi.fn();
        render(general(template, update));
        const stepSize = screen.getByLabelText("Step Size");
        fireEvent.change(stepSize, { target: { value: "0" } });
        expect(stepSize).toHaveAttribute("aria-invalid", "true");
        fireEvent.blur(stepSize);
        expect(update).not.toHaveBeenCalled();
        expect(stepSize).toHaveValue(String(template.stepSizeInUnits));
    });

    it("saves a new step size", () => {
        const update = vi.fn();
        render(general(template, update));
        const stepSize = screen.getByLabelText("Step Size");
        fireEvent.change(stepSize, { target: { value: "30" } });
        fireEvent.blur(stepSize);
        expect(update).toHaveBeenCalledTimes(1);
        expect(update.mock.calls[0][0].stepSizeInches).toBe(30);
    });

    it("labels the measurement system select as such, not with the field name", () => {
        render(general(template));
        expect(
            screen.getByRole("combobox", { name: "Measurement System" }),
        ).toBeInTheDocument();
    });
});
