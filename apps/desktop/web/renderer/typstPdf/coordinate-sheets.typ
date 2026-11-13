// Coordinate sheets for one export, compiled to PDF in the browser by the
// Typst compiler (WebAssembly). Everything that varies comes from the
// virtual file /data.json (see sheetData.ts); nothing is spliced into this
// source, so names are always plain text, never markup.
//
// /data.json:
//   showName, exportedOn: strings
//   layout: "full" | "quarter"
//   columns: [{ label, width (fraction, e.g. 0.1), align: "center" | "left" }]
//   quarterMaxRows: most rows on one quarter sheet
//   marchers: [{ drillNumber, name, section, rows: [[cell, ...], ...] }]

#let data = json("/data.json")
#let quarter = data.layout == "quarter"

#let ink = luma(20%)
#let muted = luma(55%)
#let rule = 0.6pt + luma(53%)
#let bar-fill = luma(87%)

#set document(title: data.showName + " coordinate sheets")
#set text(font: "Liberation Sans", size: if quarter { 7.5pt } else { 10.5pt }, fill: ink)
#set par(justify: false, leading: 0.45em)

// Logo + show name above, export date + page numbers below, on every page.
#set page(
  paper: "us-letter",
  margin: (x: 0.5in, top: 0.7in, bottom: 0.65in),
  header: grid(
    columns: (1fr, auto, 1fr),
    align: (left + horizon, center + horizon, right),
    image("/logo.svg", height: 16pt),
    text(size: 8pt, weight: "bold", fill: muted, data.showName),
    [],
  ),
  footer: context text(size: 7.5pt, fill: muted, grid(
    columns: (1fr, auto, 1fr),
    align: (left + horizon, center + horizon, right + horizon),
    [Exported #data.exportedOn],
    box(image("/logo.svg", height: 8pt), baseline: 1pt) + h(4pt) + [Made with OpenMarch],
    [Page #counter(page).display() of #counter(page).final().first()],
  )),
)

// Drill number | name | section (or quarter page number), grey bar.
#let performer-bar(m, last, size) = {
  let sep = line(angle: 90deg, length: 100%, stroke: (paint: luma(53%), thickness: 0.6pt, dash: "dotted"))
  let pad = if quarter { 5pt } else { 10pt }
  block(fill: bar-fill, width: 100%, inset: 0pt, grid(
    columns: (auto, 1fr, auto),
    inset: (x: pad, y: if quarter { 4pt } else { 9pt }),
    align: horizon,
    stroke: (x, _) => if x > 0 { (left: (paint: luma(53%), thickness: 0.6pt, dash: "dotted")) },
    text(size: size, weight: "bold", m.drillNumber),
    text(size: size, weight: "bold", m.name),
    text(size: size, weight: "bold", last),
  ))
}

#let col-widths = data.columns.map(c => c.width * 1fr)
#let col-align = data.columns.map(c => if c.align == "center" { center + horizon } else { left + horizon })
#let cell-inset = if quarter { (x: 3pt, y: 2.2pt) } else { (x: 6pt, y: 5pt) }

// Rows never split across pages.
#set table.cell(breakable: false)

#let header-cells = data.columns.map(c => table.cell(align: center + horizon, text(weight: "bold", c.label)))

#let row-cells(rows, zebra) = rows.enumerate().map(((i, r)) => r.enumerate().map(((j, v)) => table.cell(
  align: col-align.at(j),
  fill: if zebra and calc.even(i) { luma(94%) } else { none },
  v,
))).flatten()

#let sheet-table(bar, rows, zebra: false) = table(
  columns: col-widths,
  stroke: rule,
  inset: cell-inset,
  table.header(
    repeat: true,
    table.cell(colspan: data.columns.len(), inset: 0pt, stroke: rule, bar),
    ..header-cells,
  ),
  ..row-cells(rows, zebra),
)

#if not quarter {
  // One marcher per sheet; long tables flow onto more pages, repeating the
  // marcher bar and the column header.
  for (i, m) in data.marchers.enumerate() {
    if i > 0 { pagebreak() }
    sheet-table(performer-bar(m, m.section, 15pt), m.rows)
  }
} else {
  // Quarter pages: four sheets per Letter page. Each marcher's rows are cut
  // into sheets that fit their quarter (at most quarterMaxRows rows each).
  let page-w = 8.5in - 1in
  let page-h = 11in - 0.7in - 0.65in
  let q-w = page-w / 2
  let q-h = page-h / 2
  let q-inset = 0.08in
  let inner-w = q-w - 2 * q-inset
  let inner-h = q-h - 2 * q-inset
  context {
    let sheets = ()
    for m in data.marchers {
      // Measure the fixed part and every row once, then pack greedily.
      let fixed = measure(width: inner-w, sheet-table(performer-bar(m, [Page 99], 10pt), ())).height
      let heights = m.rows.map(r => measure(width: inner-w, table(columns: col-widths, stroke: rule, inset: cell-inset, ..row-cells((r,), false))).height)
      let start = 0
      let n = 1
      while start < m.rows.len() {
        let used = fixed + heights.at(start)
        let end = start + 1
        while end < m.rows.len() and end - start < data.quarterMaxRows and used + heights.at(end) <= inner-h {
          used += heights.at(end)
          end += 1
        }
        sheets.push((m: m, rows: m.rows.slice(start, end), n: n))
        start = end
        n += 1
      }
    }
    for (p, group) in sheets.chunks(4).enumerate() {
      if p > 0 { pagebreak() }
      grid(
        columns: (q-w, q-w),
        rows: (q-h, q-h),
        stroke: 0.8pt + luma(30%),
        inset: q-inset,
        ..group.map(s => sheet-table(performer-bar(s.m, [Page #s.n], 10pt), s.rows, zebra: true)),
      )
    }
  }
}
