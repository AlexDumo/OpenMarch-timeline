/**
 * The new field's fonts, shared by the on-screen field (`ThreeField.tsx`) and
 * the export's off-screen field (`offscreenField.tsx`), so both draw alike.
 */

/** fabric's fonts: the marcher labels'. */
export const LABEL_FONT = 'bold "Courier New", monospace';
/**
 * The field's fonts, named as fabric names them (`createFieldGrid`): its
 * default for yard numbers, and "mono" for checkpoint labels, a family that
 * doesn't exist, so the platform's fallback draws them in both fields.
 */
export const NUMBER_FONT = '"Times New Roman"';
export const CHECKPOINT_FONT = '"mono"';
/** `CollisionMarker`'s label font. */
export const COLLISION_FONT = "Arial";
