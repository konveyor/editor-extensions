#! /bin/env node

import { readFile, writeFile } from "node:fs/promises";

/**
 * Since the `excalidraw.svg` files will have URLs to the fonts that are specific to the vscode
 * extension, let's adjust them to use the normal excalidraw CDN URLs. Then if the font-face is
 * used, do a simple embed the font. It would be much nicer to minimize the font and only embed
 * the glyphs that are used, but that is much more complex.
 */
async function fixFontUrlAndInlineUsed(svgFile) {
  try {
    console.log(`Looking at: ${svgFile}`);
    const svgFileContents = await readFile(svgFile, { encoding: "utf8" });

    const updatedUrl = svgFileContents.replaceAll(
      /https:\/\/file.+?vscode-cdn.net\/.+?\/dist\/excalidraw-assets\/(.+?.woff2)/g,
      "https://unpkg.com/@excalidraw/excalidraw/dist/excalidraw-assets/$1",
    );

    const fonts = {};
    for (const [, fontFamily, fullSrc, fontUrl] of updatedUrl.matchAll(
      /font-family: "(.+?)";.*?(src: url\("?(.+?)"?\);)/gs,
    )) {
      if (fontUrl.match(/^data:/)) {
        console.log(`\tThe font for font-family ${fontFamily} is already embedded.`);
        continue;
      }

      if (updatedUrl.match(`font-family="${fontFamily}`)) {
        console.log(`\tLooks like font-family ${fontFamily} is used, embedding!`);

        const base64 = await fetch(fontUrl)
          .then((response) => response.arrayBuffer())
          .then((buffer) => Buffer.from(buffer).toString("base64"));

        fonts[fullSrc] = `src: url(data:font/woff2;base64,${base64});`;
      }
    }

    const embeddedFonts = Object.keys(fonts).reduce((svg, replaceSrc) => {
      console.log(`\treplacing: ${replaceSrc}`);
      return svg.replace(replaceSrc, fonts[replaceSrc]);
    }, updatedUrl);

    if (svgFileContents !== embeddedFonts) {
      await writeFile(svgFile, embeddedFonts, { encoding: "utf8" });
    }
  } catch (e) {
    console.error(e);
  }
}

const svgFiles = process.argv.slice(2);
for (const svgFile of svgFiles) {
  await fixFontUrlAndInlineUsed(svgFile);
}
