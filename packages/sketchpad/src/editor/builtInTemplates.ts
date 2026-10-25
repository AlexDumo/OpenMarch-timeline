import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { FieldProperties } from "@openmarch/core";
import { normalizeFieldStyle } from "../field/fieldStyle";
import { SKETCH_SCHEMA_VERSION, type SketchTemplate } from "../types";
import { createSticky } from "./scene";

/** The templates every host offers (UX spec 3.2), placed on the host's field */
export function builtInTemplates(fp: FieldProperties): SketchTemplate[] {
    const page = (elements: ExcalidrawElement[] = []) => [
        { id: "page-1", name: "Page 1", elements },
    ];
    const left = -fp.centerFrontPoint.xPixels;
    const top = -fp.height;
    const title = convertToExcalidrawElements([
        {
            type: "text",
            x: left,
            y: top - 90,
            text: "Opener",
            fontSize: 36,
            fontFamily: 5,
            strokeColor: "#1e1e1e",
        },
    ]) as ExcalidrawElement[];
    return [
        {
            id: "builtin:blank",
            name: "Blank",
            style: normalizeFieldStyle({}),
            pages: page(),
            schemaVersion: SKETCH_SCHEMA_VERSION,
        },
        {
            id: "builtin:grid-paper",
            name: "Grid paper",
            style: normalizeFieldStyle({
                preset: "paper",
                grid: false,
                halfLines: true,
                yardNumbers: false,
            }),
            pages: page(),
            schemaVersion: SKETCH_SCHEMA_VERSION,
        },
        {
            id: "builtin:hash-grid",
            name: "Hash grid",
            style: normalizeFieldStyle({
                preset: "paper",
                grid: false,
                halfLines: false,
                yardNumbers: false,
            }),
            pages: page(),
            schemaVersion: SKETCH_SCHEMA_VERSION,
        },
        {
            id: "builtin:opener",
            name: "Opener sheet",
            style: normalizeFieldStyle({}),
            pages: page([
                ...title,
                ...createSticky(
                    fp.width - fp.centerFrontPoint.xPixels - 60,
                    top - 110,
                    "yellow",
                    "Notes",
                ),
            ]),
            schemaVersion: SKETCH_SCHEMA_VERSION,
        },
    ];
}
