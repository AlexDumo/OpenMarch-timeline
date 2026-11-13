// Bonus check: one drill-chart page (field image + text) from the same engine.
// /data.json: showName, exportedOn, marcher { drillNumber, name, section },
//   set, counts, sideToSide, frontToBack, notes
// /field.svg: the field with dots, drawn by the app.
#let data = json("/data.json")
#set document(title: data.showName + " drill chart")
#set text(font: "Liberation Sans", size: 10pt)
#set page(
  paper: "us-letter",
  flipped: true,
  margin: 0.5in,
  header: grid(
    columns: (1fr, auto, 1fr),
    align: (left + horizon, center + horizon, right + horizon),
    image("/logo.svg", height: 16pt),
    text(size: 9pt, weight: "bold", data.showName),
    text(size: 9pt, [#data.marcher.drillNumber · #data.marcher.name · #data.marcher.section]),
  ),
  footer: context text(size: 7.5pt, fill: luma(55%), grid(
    columns: (1fr, 1fr),
    [Exported #data.exportedOn · Made with OpenMarch],
    align(right)[Page #counter(page).display() of #counter(page).final().first()],
  )),
)

#image("/field.svg", width: 100%)
#v(6pt)
#grid(
  columns: (auto, 1fr, 1fr),
  gutter: 14pt,
  text(size: 20pt, weight: "bold")[Set #data.set],
  [*Side to side:* #data.sideToSide \ *Front to back:* #data.frontToBack \ *Counts:* #data.counts],
  [*Notes:* #data.notes],
)
