// Handlebars templates are imported as raw text. esbuild (tsup) inlines them via
// the `.hbs` text loader; Jest inlines them via jest-hbs-transform.cjs.
declare module "*.hbs" {
  const content: string;
  export default content;
}

// The CJS compiler Handlebars entry shares the published type surface.
declare module "handlebars/dist/cjs/handlebars.js" {
  import Handlebars from "handlebars";
  export default Handlebars;
}
