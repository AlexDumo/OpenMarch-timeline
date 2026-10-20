import { ShapesIcon } from "@phosphor-icons/react";
import {
    usePaletteSource,
    type PaletteItem,
} from "@/shortcuts/palette/sources";
import type { Translate } from "@/shortcuts/labels";
import { isActionOffInWorkspace } from "@/shortcuts/workspaceActions";
import { isPreviewMode } from "@/stores/PreviewModeStore";
import { shapeSelectionGate } from "../tool/selectionGate";
import type { AnyToolKind } from "../tool/toolKind";
import { TOOL_KINDS } from "../tool/toolKinds";
import { beginShapeCommand } from "./shapeCommand";

/** The Shape branch's id in the command tree */
export const SHAPE_BRANCH = "shape";

/**
 * The saved shapes listed in the Shape branch after the kinds (#344 story 19). Saved shapes come
 * with the library (#352, #353); this is where they join the branch, each a command that opens
 * its kind with its intervals.
 */
export function savedShapeItems(): readonly PaletteItem[] {
    return [];
}

/**
 * The command bar's Shape branch (#354): Shape › Box, one entry per kind, asking the kind's
 * declared parameters. A kind is greyed out with the selection gate's reason when it can't open,
 * or the workspace's when shapes are off there.
 */
export function useShapePaletteSource(
    ready: boolean,
    selected: readonly { readonly id: number }[],
): void {
    usePaletteSource("shapes", ({ t }) => [
        {
            id: SHAPE_BRANCH,
            label: t("commandPalette.shape"),
            group: t("settings.shortcuts.category.shape"),
            icon: <ShapesIcon size={18} />,
            keywords: t("actions.shape.keywords").split(/\s+/),
            children: () => [
                ...TOOL_KINDS.map((kind) => kindItem(kind, ready, selected, t)),
                ...savedShapeItems(),
            ],
        },
    ]);
}

function kindItem(
    kind: AnyToolKind,
    ready: boolean,
    selected: readonly { readonly id: number }[],
    t: Translate,
): PaletteItem {
    const gate = shapeSelectionGate(selected);
    // Shapes edit the drill, like the box tool's key
    const offHere = isActionOffInWorkspace("shapeBlock");
    const Icon = kind.shape.icon;
    const label = kind.shape.label;
    return {
        id: `${SHAPE_BRANCH}:${kind.shape.id}`,
        label,
        group: t("commandPalette.shape"),
        icon: <Icon size={18} />,
        keywords: [kind.shape.id],
        disabled: !ready || offHere || !gate.ok,
        disabledReason: offHere
            ? t(
                  isPreviewMode()
                      ? "commandPalette.offInPreview"
                      : "commandPalette.editsDrill",
              )
            : !gate.ok
              ? gate.reason
              : undefined,
        command: {
            begin: () =>
                beginShapeCommand(kind, gate.ok ? gate.ids : [], [
                    t("commandPalette.shape"),
                    label,
                ]),
        },
    };
}
