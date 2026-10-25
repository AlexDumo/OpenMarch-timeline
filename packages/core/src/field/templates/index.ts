import FootballFieldTemplates from "./Football";
import GridFieldTemplates from "./GridFields";

export { FootballFieldTemplates, GridFieldTemplates };
export { createGridXCheckpoints, createGridYCheckpoints } from "./GridFields";

/** Every preset field layout, by key. */
export const FieldPropertiesTemplates = {
    ...FootballFieldTemplates,
    ...GridFieldTemplates,
} as const;
