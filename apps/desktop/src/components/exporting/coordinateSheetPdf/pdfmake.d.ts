// cspell:ignore pdfmake pdfs dont ijlft helv xthrottle Dvořák Émile García Łukasz Nguyễn Núñez Østergaard Šťastný Ελένη Παπαδοπούλου Иванова Ольга محمد
// pdfmake 0.3 ships no type declarations; we only touch a few methods.
declare module "pdfmake/build/pdfmake" {
    const pdfMake: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    export default pdfMake;
}
declare module "pdfmake/build/fonts/Roboto" {
    const fontContainer: unknown;
    export default fontContainer;
}
declare module "pdfmake/build/standard-fonts/Helvetica" {
    const fontContainer: unknown;
    export default fontContainer;
}
