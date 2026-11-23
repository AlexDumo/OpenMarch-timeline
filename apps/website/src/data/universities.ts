/**
 * Programs shown on /universities.
 *
 * PLACEHOLDER — replace with owner-verified list.
 *
 * Every entry below is invented filler so the page can be designed before the
 * real list exists. None of them names a real school, course or person. When the
 * verified list arrives: replace `programs`, set `PROGRAMS_ARE_PLACEHOLDERS` to
 * false, and the "concept preview" switch and placeholder marks disappear.
 */

export interface UniversityProgram {
    /** Short stable id, used for anchors and for linking a dot to its row. */
    id: string;
    /** School name as the school writes it. */
    school: string;
    /** Course title and number, e.g. "Marching Band Techniques (MUED 3xx)". */
    course: string;
    /** First term the course used OpenMarch, e.g. "Fall 2025". */
    since: string;
    /** City and state or country. Optional. */
    location?: string;
    /** Link to the program or course page. Optional. */
    url?: string;
    /**
     * Logo files in `src/assets/universities/`. Optional: the name in text is
     * the default. Give both so the mark reads on either theme.
     */
    logo?: { light: string; dark: string };
    /** A sentence or two from the instructor, with written permission. Optional. */
    quote?: {
        text: string;
        name: string;
        /** e.g. "Associate Director of Bands". */
        role: string;
    };
}

/** Flip to false once `programs` holds the verified list. */
export const PROGRAMS_ARE_PLACEHOLDERS = true;

const placeholderCourses = [
    "Marching Band Techniques (MUED 3xx)",
    "Marching Band Methods (MUSE 4xx)",
    "Drill Design (MUS 3xx)",
    "Instrumental Methods II (MUED 4xx)",
];
const placeholderTerms = ["Fall 2025", "Spring 2026", "Fall 2026"];

// PLACEHOLDER — replace with owner-verified list.
export const programs: UniversityProgram[] = Array.from(
    { length: 30 },
    (_, i): UniversityProgram => {
        const n = String(i + 1).padStart(2, "0");
        return {
            id: `placeholder-${n}`,
            school: `University Name ${n}`,
            course: placeholderCourses[i % placeholderCourses.length],
            since: placeholderTerms[i % placeholderTerms.length],
            location: "City, State",
            quote:
                i < 3
                    ? {
                          text: "Placeholder for a sentence or two from the instructor about teaching the course with OpenMarch.",
                          name: "Faculty Name",
                          role: "Faculty title",
                      }
                    : undefined,
        };
    },
);

/** Concept only: list sizes the preview switch can show. */
export const PREVIEW_COUNTS = [3, 12, 30] as const;

export const CONTACT_EMAIL = "contact@openmarch.com";
export const ADD_PROGRAM_MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
    "Add our program to OpenMarch for Universities",
)}`;
export const EDITOR_URL = "https://editor.openmarch.com";
