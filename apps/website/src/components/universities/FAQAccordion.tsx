// Same accordion as the On The Move page (`components/mobile/FAQAccordion.tsx`),
// with this page's questions. If that component learns to take its questions as a
// prop, this file can become a list.
import * as Accordion from "@radix-ui/react-accordion";
import { CaretDownIcon } from "@phosphor-icons/react";
import { CONTACT_EMAIL, EDITOR_URL } from "@/data/universities";

const link = "text-accent underline";

const faqs = [
    {
        question: "Does anything need to be installed on lab computers?",
        answer: (
            <>
                <p>
                    No. OpenMarch runs in a browser at{" "}
                    <a href={EDITOR_URL} className={link}>
                        editor.openmarch.com
                    </a>
                    , so a lab machine only needs a browser.
                </p>
                <p>
                    If you would rather have an installed app, there is a
                    desktop app for Mac, Windows and Linux on the{" "}
                    <a href="/download" className={link}>
                        download page
                    </a>
                    .
                </p>
            </>
        ),
    },
    {
        question: "Is there a license to buy or renew for the department?",
        answer: (
            <p>
                No. OpenMarch is free and open source, for a whole class as much
                as for one person. There are no site licenses and no seat counts
                to keep track of for the editor.
            </p>
        ),
    },
    {
        question: "Can students work on their own devices?",
        answer: (
            <>
                <p>
                    Yes. Students can use the browser editor, or the desktop app
                    on Mac, Windows and Linux.
                </p>
                <p>
                    OpenMarch also has a tablet layout and works with Apple
                    Pencil.
                </p>
            </>
        ),
    },
    {
        question: "What do students hand in?",
        answer: (
            <>
                <p>
                    A show is a single <code>.dots</code> file. Students can
                    also export drill charts and coordinate sheets as PDF, and a
                    video of the show from 3D View.
                </p>
            </>
        ),
    },
    {
        question: "What happens when students graduate?",
        answer: (
            <p>
                Nothing changes. OpenMarch stays free, so graduates keep using
                the tool they learned on when they write for their own
                ensembles.
            </p>
        ),
    },
    {
        question: "Can we review the source code?",
        answer: (
            <p>
                Yes. OpenMarch is open source and developed in the open on{" "}
                <a
                    href="https://github.com/OpenMarch/OpenMarch"
                    className={link}
                >
                    GitHub
                </a>
                .
            </p>
        ),
    },
    {
        question: "How do we get our program listed?",
        answer: (
            <p>
                Write to{" "}
                <a href={`mailto:${CONTACT_EMAIL}`} className={link}>
                    {CONTACT_EMAIL}
                </a>{" "}
                with your school, the course and the first term it used
                OpenMarch. We confirm the listing with you before it appears.
            </p>
        ),
    },
];

export default function FAQAccordion() {
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
