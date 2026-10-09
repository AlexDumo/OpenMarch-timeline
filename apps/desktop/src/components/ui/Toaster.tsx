import {
    CheckCircleIcon,
    WarningIcon,
    SealWarningIcon,
    InfoIcon,
    CircleNotchIcon,
} from "@phosphor-icons/react";
import { Toaster as ToasterPrimitive } from "sonner";

export default function Toaster() {
    return (
        <ToasterPrimitive
            visibleToasts={6}
            toastOptions={{
                unstyled: true,
                classNames: {
                    title: "text-body text-text leading-none",
                    description: "text-sub text-text",
                    toast: "p-20 flex gap-8 bg-modal rounded-6 border border-stroke font-sans w-full backdrop-blur-md shadow-modal",
                    content: "min-w-0 flex-1",
                    // The action keeps to one line beside the text, so a long message never squeezes
                    // its label into a column
                    actionButton:
                        "shrink-0 self-center whitespace-nowrap rounded-6 px-8 py-4 text-body text-accent hover:underline focus-visible:outline-none focus-visible:ring focus-visible:ring-accent",
                },
            }}
            icons={{
                success: <CheckCircleIcon size={24} className="text-green" />,
                info: <InfoIcon size={24} className="text-text" />,
                warning: <WarningIcon size={24} className="text-yellow" />,
                error: <SealWarningIcon size={24} className="text-red" />,
                loading: <CircleNotchIcon size={24} className="text-text" />,
            }}
        />
    );
}
