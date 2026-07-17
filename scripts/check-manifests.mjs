import { readFile } from "node:fs/promises";

const paths = ["plugin/manifest.json", "plugin-shopify/manifest.json"];
const requiredEditors = ["figma", "figjam", "slides"];

for (const path of paths) {
  const manifest = JSON.parse(await readFile(path, "utf8"));
  const editors = new Set(manifest.editorType ?? []);

  for (const editor of requiredEditors) {
    if (!editors.has(editor)) {
      throw new Error(`${path} is missing editorType ${editor}`);
    }
  }

  if (editors.has("dev") && editors.has("figjam")) {
    throw new Error(`${path} cannot combine dev and figjam`);
  }
}

console.log("Plugin manifests are valid for Design, FigJam, and Slides.");
