import { useSidebarModalStore } from "@/stores/SidebarModalStore";
import { PropListContents } from "./PropsModal";

/** Asks again open the panel afresh, so Add flag opens each time */
let opened = 0;

/**
 * Opens the Props panel, with its Flags group's Add flag open for the `addFlag` action (fork
 * #985).
 */
export function showPropsPanel({ addFlag = false } = {}) {
    const { setContent, setOpen } = useSidebarModalStore.getState();
    setContent(
        <PropListContents key={++opened} addingFlag={addFlag} />,
        "props",
    );
    setOpen(true);
}
