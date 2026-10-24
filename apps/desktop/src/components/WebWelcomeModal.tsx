import { Description as DialogDescription } from "@radix-ui/react-dialog";
import { Button, Dialog, DialogContent, DialogTitle } from "@openmarch/ui";
import { useWebWelcomeStore } from "@/stores/WebWelcomeStore";
import { useWelcomeFlowStore } from "@/stores/WelcomeFlowStore";
import { webChannel } from "@/utilities/webBuild";

/**
 * Explains the web build. Opens once per browser session when the app starts
 * and again from the "Web" badge in the title bar. It waits while the welcome
 * flow is on screen.
 */
export default function WebWelcomeModal() {
    const { open, setOpen } = useWebWelcomeStore();
    const welcomeFlowShowing = useWelcomeFlowStore((s) => s.showing);
    const save = window.electron.isMacOS ? "⌘S" : "Ctrl+S";

    return (
        <Dialog open={open && !welcomeFlowShowing} onOpenChange={setOpen}>
            <DialogContent className="w-[40rem]">
                <DialogTitle>Welcome to OpenMarch on the web!</DialogTitle>
                <div className="text-text-subtitle flex flex-col gap-16 text-sm">
                    <DialogDescription asChild>
                        <p>
                            This version runs entirely in your browser. It does
                            not have all the features of the desktop app, and
                            some things that rely on your computer, like
                            exporting and native windows, are not available.
                        </p>
                    </DialogDescription>
                    {webChannel === "lab" ? (
                        <p>
                            This is a test build of a feature that is still in
                            development, so expect rough edges. Your show stays
                            on this computer: the editor does not upload it.
                            Open an example show, an existing <code>.dots</code>{" "}
                            file or start a new one to begin.
                        </p>
                    ) : (
                        <p>
                            There are no accounts and nothing is uploaded: your
                            show stays on this computer. Open an existing{" "}
                            <code>.dots</code> file or start a new one to begin.
                        </p>
                    )}
                    <p>
                        <strong className="text-text">
                            Download your show to save it ({save}).
                        </strong>{" "}
                        This browser keeps a backup between visits, but it can
                        clear it, so the downloaded <code>.dots</code> file is
                        your saved copy. To keep working later, open that file
                        again.
                    </p>
                    <div className="flex justify-end pt-16">
                        <Button onClick={() => setOpen(false)}>Got it</Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
