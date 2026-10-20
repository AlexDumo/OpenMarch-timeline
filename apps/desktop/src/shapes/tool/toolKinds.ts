import { boxTool } from "../box/boxTool";
import type { AnyToolKind } from "./toolKind";

/** Every shape kind there is to pick, in the order pickers list them (spec #344) */
export const TOOL_KINDS: readonly AnyToolKind[] = [boxTool];
