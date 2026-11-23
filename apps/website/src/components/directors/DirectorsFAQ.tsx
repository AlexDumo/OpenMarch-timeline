// Same accordion as components/mobile/FAQAccordion.tsx, with the directors' questions.
import * as Accordion from "@radix-ui/react-accordion";
import { CaretDownIcon } from "@phosphor-icons/react";
import { FREE_SEATS_PER_ENSEMBLE, SEAT_PRICE_LABEL } from "@/lib/seats";

const link = "text-accent underline";

const faqs = [
    {
        question: "What does it cost?",
        answer: (
            <>
                <p>
                    Nothing. The drill editor is free and open source: no
                    license, no per-director fee and no trial that runs out.
                </p>
                <p>
                    The phone app for students, <em>On The Move</em>, is
                    optional. Every ensemble gets {FREE_SEATS_PER_ENSEMBLE} free
                    seats, and more are {SEAT_PRICE_LABEL} a seat for the
                    season.{" "}
                    <a href="/mobile#pricing" className={link}>
                        See pricing
                    </a>
                    .
                </p>
            </>
        ),
    },
    {
        question: "Do I have to install anything on a school computer?",
        answer: (
            <>
                <p>
                    No. The web editor at{" "}
                    <a href="https://editor.openmarch.com" className={link}>
                        editor.openmarch.com
                    </a>{" "}
                    runs in a browser, with no install and no account.
                </p>
                <p>
                    Two things to know: the web editor keeps shows in that
                    browser on that device, so use Back up to save a copy
                    somewhere else. And PDF drill charts and coordinate sheets
                    are exported from the desktop app, not the web editor.
                </p>
            </>
        ),
    },
    {
        question: "Which computers does the desktop app run on?",
        answer: (
            <p>
                macOS, Windows and Linux. It updates itself when a new version
                is out.{" "}
                <a href="/download" className={link}>
                    Download it here
                </a>
                .
            </p>
        ),
    },
    {
        question: "Does it work on an iPad at rehearsal?",
        answer: (
            <p>
                Yes. Open the web editor in Safari on an iPad, or in Chrome on
                an Android tablet; on a Windows tablet use the desktop app.
                Everything works with a finger or a pen such as Apple Pencil.
                Phones are too small for the editor.
            </p>
        ),
    },
    {
        question: "Do students need accounts? What do you collect about them?",
        answer: (
            <p>
                Students don’t create accounts and OpenMarch doesn’t collect
                their personal information. In <em>On The Move</em> they enter
                the ensemble code and password you give them. The editor needs
                no account either, and shows in the web editor aren’t uploaded.
            </p>
        ),
    },
    {
        question: "Can I open the drill my writer sent me?",
        answer: (
            <p>
                If it was written in OpenMarch, yes: a show is one{" "}
                <code>.dots</code> file that opens in the desktop app or the web
                editor. Pyware files can’t be opened yet;{" "}
                <a href="#pyware" className={link}>
                    import is planned
                </a>
                .
            </p>
        ),
    },
    {
        question: "What happens to my shows if OpenMarch goes away?",
        answer: (
            <p>
                Your shows are files you keep, not records in our system, and
                the app’s code is public on{" "}
                <a href="https://github.com/OpenMarch" className={link}>
                    GitHub
                </a>
                . The version you have keeps working.
            </p>
        ),
    },
    {
        question: "Where do I get help?",
        answer: (
            <p>
                The{" "}
                <a href="/guides" className={link}>
                    guides
                </a>{" "}
                cover every task with pictures, and directors and the people who
                build OpenMarch answer questions on{" "}
                <a href="https://discord.gg/eTsQ98uZzq" className={link}>
                    Discord
                </a>
                .
            </p>
        ),
    },
];

export default function DirectorsFAQ() {
    return (
        <Accordion.Root
            type="single"
            collapsible
            className="flex w-full flex-col gap-8"
        >
            {faqs.map((faq) => (
                <Accordion.Item
                    key={faq.question}
                    value={faq.question}
                    className="border-stroke bg-fg-1 rounded-6 border"
                >
                    <Accordion.Header>
                        <Accordion.Trigger className="text-text group text-body flex w-full items-center justify-between gap-16 px-24 py-18 text-left max-[520px]:px-16">
                            <span>{faq.question}</span>
                            <CaretDownIcon
                                size={20}
                                className="text-text-subtitle shrink-0 transition-transform duration-150 group-data-[state=open]:rotate-180"
                                aria-hidden="true"
                            />
                        </Accordion.Trigger>
                    </Accordion.Header>
                    <Accordion.Content className="overflow-hidden">
                        <div className="text-text-subtitle text-body flex flex-col gap-12 px-24 pb-20 leading-relaxed max-[520px]:px-16">
                            {faq.answer}
                        </div>
                    </Accordion.Content>
                </Accordion.Item>
            ))}
        </Accordion.Root>
    );
}
