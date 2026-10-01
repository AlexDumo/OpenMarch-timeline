"""Ask Jev whether converted formations match page-mode ones (docs/timeline/phases/06-converter.md P6.6).

Reads the JSON report of the conversion corpus runner
(apps/desktop/src/timeline/__test__/conversionCorpus.test.ts). For each show's sampled moments it
sends Jev only the two lists of coordinates (page mode and converted, the same marchers in the
same order) and asks whether they are the same formation with every marcher in the same place.
Perturbed controls check that Jev tells different formations apart.

The numeric comparison in the report is authoritative; this is a judgment layer on top of it.
No names, file names or ids are sent, and only aggregate numbers are printed.

    uv run jev_equality.py /tmp/conversion-corpus.json [--out /tmp/jev.json] [--max-marchers 48]
"""

# cspell:ignore typesafe Noul noul

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

COORDINATES = (
    "Each point is [x, y] in canvas pixels on a football field and marks where one marcher stands. "
    "x increases to the right and y increases downward. Point i in `page_mode` and point i in "
    "`converted` are the same marcher."
)

#: Numeric verdict: two formations are the same when no marcher is further apart than this (pixels)
SAME_TOLERANCE = 0.01
#: Jev's verdict: "same" when the probability is at least this
JEV_THRESHOLD = 0.5


def questions():
    from typesafe_sdk import Choice, Noul

    return {
        "same": Noul(
            instructions="Do `page_mode` and `converted` show the same formation, with every marcher "
            "(point i in both lists) standing in the same place?",
        ),
        "difference": Choice(
            instructions="How do the two formations in `page_mode` and `converted` differ?",
            criteria={
                "identical": "Every marcher is in the same place in both lists.",
                "few_moved": "Most marchers match, but one or a few are in a different place.",
                "swapped": "The same set of spots is filled, but some marchers have traded places.",
                "shifted": "The whole formation is moved, turned or mirrored.",
                "different": "The formations are different shapes.",
            },
        ),
    }


def subset(n: int, cap: int) -> list[int]:
    """Up to `cap` indexes spread evenly over `n`, in order."""
    if n <= cap:
        return list(range(n))
    return sorted({round(i * (n - 1) / (cap - 1)) for i in range(cap)})


def rounded(points) -> list[list[float]]:
    return [[round(x, 1), round(y, 1)] for x, y in points]


def max_distance(a, b) -> float:
    return max((math.dist(p, q) for p, q in zip(a, b)), default=0.0)


def controls(points: list[list[float]]) -> list[tuple[str, list[list[float]]]]:
    """Perturbed copies of `points`: one identical control and four that differ."""
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    extent = max(max(xs) - min(xs), max(ys) - min(ys), 1.0)
    cx = (max(xs) + min(xs)) / 2
    one_moved = [p[:] for p in points]
    k = len(points) // 2
    one_moved[k] = [one_moved[k][0] + 0.25 * extent, one_moved[k][1] + 0.15 * extent]
    swapped = [p[:] for p in points]
    far = max(range(len(points)), key=lambda j: math.dist(points[0], points[j]))
    swapped[0], swapped[far] = swapped[far], swapped[0]
    return [
        ("identical", [p[:] for p in points]),
        ("one_moved", one_moved),
        ("swapped", swapped),
        ("shifted", [[x + 0.2 * extent, y + 0.1 * extent] for x, y in points]),
        ("mirrored", [[2 * cx - x, y] for x, y in points]),
    ]


def ask(client, page_mode, converted) -> dict:
    answers = client.system_one(
        state={"coordinate_system": COORDINATES, "page_mode": page_mode, "converted": converted},
        questions=questions(),
    ).answers
    return {
        "same": answers["same"].noul,
        "difference": answers["difference"].choice,
        "confidence": answers["difference"].confidence,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("report", type=Path, help="the corpus runner's JSON report")
    parser.add_argument("--out", type=Path, help="where to write Jev's answers (default: next to the report)")
    parser.add_argument("--max-marchers", type=int, default=48, help="marchers sent per moment")
    parser.add_argument("--samples", type=int, default=6, help="moments per show")
    args = parser.parse_args()

    report = json.loads(args.report.read_text())
    items = []  # (show, kind, expected_same, numeric_max, page_mode, converted)
    for n, show in enumerate(report["shows"], start=1):
        samples = show["equality"]["samples"][: args.samples]
        for s in samples:
            idx = subset(len(s["marcherIds"]), args.max_marchers)
            page_mode = rounded([s["pageMode"][i] for i in idx])
            converted = rounded([s["converted"][i] for i in idx])
            numeric = max_distance(
                [s["pageMode"][i] for i in idx], [s["converted"][i] for i in idx]
            )
            items.append((n, s["kind"], numeric <= SAME_TOLERANCE, numeric, page_mode, converted))
        if samples:
            base = rounded([samples[0]["pageMode"][i] for i in subset(len(samples[0]["marcherIds"]), args.max_marchers)])
            for name, perturbed in controls(base):
                items.append((n, f"control:{name}", name == "identical", max_distance(base, perturbed), base, perturbed))

    print(f"{len(items)} judgments ({sum(1 for i in items if not i[1].startswith('control'))} samples, "
          f"{sum(1 for i in items if i[1].startswith('control'))} controls)")

    results = []
    try:
        from typesafe_sdk import TypeSafeClient

        with TypeSafeClient() as client:
            for show, kind, expected, numeric, page_mode, converted in items:
                answer = ask(client, page_mode, converted)
                results.append({
                    "show": show, "kind": kind, "numericSame": expected, "numericMax": numeric,
                    **answer, "agrees": (answer["same"] >= JEV_THRESHOLD) == expected,
                })
    except Exception as error:  # noqa: BLE001 - any SDK or network failure falls back to numbers
        print(f"Jev could not be reached ({type(error).__name__}: {error}); "
              "the numeric comparison in the report stands on its own.")
        for show, kind, expected, numeric, *_ in items:
            print(f"  show {show} {kind}: numeric {'same' if expected else 'different'} (max {numeric:.3g} px)")
        return 0

    out = args.out or args.report.with_suffix(".jev.json")
    out.write_text(json.dumps(results, indent=1))

    def rate(rows):
        return f"{sum(r['agrees'] for r in rows)}/{len(rows)}" if rows else "0/0"

    for show in sorted({r["show"] for r in results}):
        rows = [r for r in results if r["show"] == show]
        samples = [r for r in rows if not r["kind"].startswith("control")]
        ctrl = [r for r in rows if r["kind"].startswith("control")]
        print(f"show {show}: samples agree {rate(samples)}, controls agree {rate(ctrl)}")
        for r in rows:
            print(f"  {r['kind']:<20} numeric {'same' if r['numericSame'] else 'diff'}  "
                  f"P(same)={r['same']:.2f}  {r['difference']} ({r['confidence']:.2f})")
    samples = [r for r in results if not r["kind"].startswith("control")]
    ctrl = [r for r in results if r["kind"].startswith("control")]
    print(f"overall: samples agree {rate(samples)}, controls agree {rate(ctrl)}; wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
