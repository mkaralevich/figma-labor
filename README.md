# figma-labor plugin

Figma Plugin API client for the [pi-figma-labor](https://github.com/mkaralevich/pi-figma-labor) bridge.

## Variants

- `plugin/` — personal/local Labor plugin
- `plugin-shopify/` — Shopify-distributed Pi Labor plugin

Both manifests support Figma Design, FigJam, and Figma Slides:

```json
"editorType": ["figma", "figjam", "slides"]
```

Figma does not permit one plugin manifest to target both FigJam and Dev Mode. These plugins prioritize local canvas operations in Design, FigJam, and Slides. The desktop MCP server remains the Dev Mode integration.

## Development

Install the current Plugin API typings:

```sh
npm install
```

Import the appropriate `manifest.json` through Figma Desktop → Plugins → Development → Import plugin from manifest.

## Verified behavior

Live testing confirmed:

- Slides reports `figma.editorType === "slides"`, exposes `currentPage.focusedSlide`, and accepts local Plugin API writes inside a slide.
- FigJam reports `figma.editorType === "figjam"` and supports native sticky creation, selection, zoom, fills, and text updates.
- FigJam embedded text requires its font to be loaded before changing `characters`; the default sticky font observed in testing was Inter Medium.
- Newly created connectors report an empty font name until a valid font is assigned. Connector label creation and updates therefore fall back to Inter Regular.
- Code blocks require Source Code Pro Medium to be loaded before assigning `code`.
- Native connector creation, endpoints, labels, table creation, compound table-cell reads/text updates, and section creation were verified live.
- Native node serialization must explicitly include product properties. Generic geometry serialization alone omits values such as sticky text, connector endpoints, slide transitions, and interactive slide element types.
- Successful mutation commands call `figma.commitUndo()` so `figma.triggerUndo()` reverts only the latest command rather than every write since plugin launch.
- Desktop MCP `get_figjam` successfully verified the created native sticky. Desktop MCP rejected `get_screenshot` in Slides during testing, so Slides verification uses local reads and viewport zoom.

## Release checklist

1. Test the local manifest in Design, FigJam, and Slides.
2. Confirm the local bridge reports the correct editor context in each product.
3. Test selection, read, write, zoom, and single-command undo operations.
4. In FigJam, test a native sticky, connector label, code block, table cell, section, and embedded text update.
5. In Slides, test focused-slide placement and a slide read.
6. Publish the matching plugin variant through Figma.
