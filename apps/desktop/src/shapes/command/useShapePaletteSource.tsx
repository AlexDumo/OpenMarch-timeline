import { ShapesIcon } from "@phosphor-icons/react";
import {
    usePaletteSource,
    type PaletteItem,
} from "@/shortcuts/palette/sources";
import type { Translate } from "@/shortcuts/labels";
import { isActionOffInWorkspace } from "@/shortcuts/workspaceActions";
import { isPreviewMode } from "@/stores/PreviewModeStore";
import { kindPickGate } from "../tool/pickKind";
import { shapeSelectionGate } from "../tool/selectionGate";
import type { AnyToolKind } from "../tool/toolKind";
import { SHAPE_TOOLS } from "../tool/shapeTools";
import { useShapeToolStore } from "../tool/shapeToolStore";
import { beginShapeCommand } from "./shapeCommand";
import type { ShapeLibraryRow } from "../library/shapeLibrary";
import { useShapeLibraryRows } from "../library/shapeStars";

/** The Shape branch's id in the command tree */
export const SHAPE_BRANCH = "shape";

/**
 * The saved shapes listed in the Shape branch after the kinds (#344 story 19, #353), each a
 * command that opens its kind with its intervals, by its name
 */
export function savedShapeItems(
    rows: readonly ShapeLibraryRow[],
    ready: boolean,
    selected: readonly { readonly id: number }[],
    t: Translate,
    place: () => Promise<void>,
): readonly PaletteItem[] {
    return rows.flatMap((row) =>
        row.saved
            ? [
                  kindItem(row.kind, ready, selected, t, place, {
                      id: row.id,
                      label: row.label,
                  }),
              ]
            : [],
    );
}

/**
 * The command bar's Shape branch (#354): Shape › Box, one entry per kind, asking the kind's
 * declared parameters. A kind is greyed out with the selection gate's reason when it can't open,
 * or the workspace's when shapes are off there.
 */
export function useShapePaletteSource(
    ready: boolean,
    selected: readonly { readonly id: number }[],
    /** The host's place for the open shape (Place, Enter), which the last answer runs */
    place: () => Promise<void>,
): void {
    const rows = useShapeLibraryRows();
    usePaletteSource("shapes", ({ t }) => [
        {
            id: SHAPE_BRANCH,
            label: t("commandPalette.shape"),
            group: t("settings.shortcuts.category.shape"),
            icon: <ShapesIcon size={18} />,
            keywords: t("actions.shape.keywords").split(/\s+/),
            children: () => [
                ...SHAPE_TOOLS.map(({ kind }) =>
                    kindItem(kind, ready, selected, t, place),
                ),
                ...savedShapeItems(rows, ready, selected, t, place),
            ],
        },
    ]);
}

function kindItem(
    kind: AnyToolKind,
    ready: boolean,
    selected: readonly { readonly id: number }[],
    t: Translate,
    place: () => Promise<void>,
    /** A saved shape's own id and name; the kind's when absent */
    named?: { readonly id: string; readonly label: string },
): PaletteItem {
    const gate = shapeSelectionGate(selected);
    // With a shape open, any kind can be picked: the open shape turns into it
    const pick = kindPickGate(
        useShapeToolStore.getState().tool !== null,
        selected,
    );
    // Shapes edit the drill, like the box tool's key
    const offHere = isActionOffInWorkspace("shapeBlock");
    const Icon = kind.shape.icon;
    const label = named?.label ?? kind.shape.label;
    return {
        id: `${SHAPE_BRANCH}:${named?.id ?? kind.shape.id}`,
        label,
        group: t("commandPalette.shape"),
        icon: <Icon size={18} />,
        keywords: named ? [kind.shape.id, kind.shape.label] : [kind.shape.id],
        disabled: !ready || offHere || !pick.ok,
        disabledReason: offHere
            ? t(
                  isPreviewMode()
                      ? "commandPalette.offInPreview"
                      : "commandPalette.editsDrill",
              )
            : !pick.ok
              ? pick.reason
              : undefined,
        command: {
            begin: () =>
                beginShapeCommand(
                    kind,
                    gate.ok ? gate.ids : [],
                    [t("commandPalette.shape"), label],
                    place,
                ),
        },
    };
}
