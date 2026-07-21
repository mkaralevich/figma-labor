// ## Main thread bridge

figma.showUI(__html__, {
  width: 220,
  height: 120,
  title: "Pi Labor",
  themeColors: true,
});

const MUTATING_COMMANDS = new Set([
  "update_properties",
  "resize_node",
  "scale_node",
  "update_fills",
  "update_text",
  "update_table",
  "create_node",
  "delete_node",
  "clone_node",
  "move_node",
  "detach_instance",
  "create_instance",
  "set_layout",
  "reorder_variant_options",
  "create_component_set",
  "run_script",
]);

figma.ui.onmessage = async (msg) => {
  if (msg.type === "resize") {
    figma.ui.resize(220, msg.height);
    return;
  }
  if (msg.type === "context_request") {
    figma.ui.postMessage({
      type: "plugin_context",
      context: getPluginContext(),
    });
    return;
  }

  const { id, command, params } = msg;
  try {
    const result = await executeCommand(command, params);
    if (MUTATING_COMMANDS.has(command)) figma.commitUndo();
    figma.ui.postMessage({ id, result });
  } catch (err) {
    figma.ui.postMessage({ id, error: err.message });
  }
};

async function executeCommand(command, params) {
  switch (command) {
    // ## Undo commands

    case "undo": {
      figma.triggerUndo();
      return { success: true };
    }

    // ## Read commands

    case "get_node": {
      const node = await safeGetNodeById(params.nodeId);
      if (!node) throw new Error(`Node not found: ${params.nodeId}`);
      return serializeNode(node);
    }

    case "get_selection": {
      return figma.currentPage.selection.map(serializeNode);
    }

    case "get_children": {
      const node = params.nodeId
        ? await safeGetNodeById(params.nodeId)
        : figma.currentPage;
      if (!node) throw new Error(`Node not found: ${params.nodeId}`);
      if (!("children" in node)) throw new Error("Node has no children");
      return node.children.map(serializeNode);
    }

    // ## Update commands

    case "update_properties": {
      const node = await requireNode(params.nodeId);
      const p = params.properties || {};
      if (p.name !== undefined) node.name = p.name;
      setSupportedProperty(node, "x", p.x);
      setSupportedProperty(node, "y", p.y);
      setSupportedProperty(node, "opacity", p.opacity);
      setSupportedProperty(node, "visible", p.visible);
      setSupportedProperty(node, "rotation", p.rotation);
      setSupportedProperty(node, "authorVisible", p.authorVisible);
      setSupportedProperty(node, "isWideWidth", p.isWideWidth);
      setSupportedProperty(
        node,
        "sectionContentsHidden",
        p.sectionContentsHidden,
      );
      setSupportedProperty(node, "codeLanguage", p.codeLanguage);
      setSupportedProperty(node, "connectorLineType", p.connectorLineType);
      setSupportedProperty(
        node,
        "connectorStartStrokeCap",
        p.connectorStartStrokeCap,
      );
      setSupportedProperty(
        node,
        "connectorEndStrokeCap",
        p.connectorEndStrokeCap,
      );
      if (p.connectorStartNodeId !== undefined) {
        if (node.type !== "CONNECTOR") {
          throw new Error(
            `${node.type} nodes do not support connectorStartNodeId`,
          );
        }
        const magnet =
          p.connectorStartMagnet ??
          (node.connectorLineType === "STRAIGHT" ? "CENTER" : "AUTO");
        node.connectorStart = {
          endpointNodeId: p.connectorStartNodeId,
          magnet,
        };
      } else if (p.connectorStartMagnet !== undefined) {
        throw new Error("connectorStartMagnet requires connectorStartNodeId");
      }
      if (p.connectorEndNodeId !== undefined) {
        if (node.type !== "CONNECTOR") {
          throw new Error(
            `${node.type} nodes do not support connectorEndNodeId`,
          );
        }
        const magnet =
          p.connectorEndMagnet ??
          (node.connectorLineType === "STRAIGHT" ? "CENTER" : "AUTO");
        node.connectorEnd = {
          endpointNodeId: p.connectorEndNodeId,
          magnet,
        };
      } else if (p.connectorEndMagnet !== undefined) {
        throw new Error("connectorEndMagnet requires connectorEndNodeId");
      }
      if (p.width !== undefined || p.height !== undefined) {
        if (!("resize" in node)) {
          throw new Error(`${node.type} nodes cannot be resized`);
        }
        node.resize(
          p.width !== undefined ? p.width : node.width,
          p.height !== undefined ? p.height : node.height,
        );
      }
      return serializeNode(node);
    }

    case "resize_node": {
      const node = await requireNode(params.nodeId);
      if (!("resize" in node)) throw new Error("Node cannot be resized");
      node.resize(params.width, params.height);
      figma.viewport.scrollAndZoomIntoView([node]);
      return serializeNode(node);
    }

    case "scale_node": {
      const node = await requireNode(params.nodeId);
      if (!("rescale" in node)) throw new Error("Node cannot be scaled");
      node.rescale(params.scale);
      figma.viewport.scrollAndZoomIntoView([node]);
      return serializeNode(node);
    }

    case "update_fills": {
      const node = await requireNode(params.nodeId);
      if (!("fills" in node)) throw new Error("Node has no fills");
      // ## Solid fill params
      node.fills = params.fills.map((f) => ({
        type: "SOLID",
        color: { r: f.r, g: f.g, b: f.b },
        opacity: f.a !== undefined ? f.a : 1,
      }));
      return serializeNode(node);
    }

    case "update_text": {
      const node = await requireNode(params.nodeId);
      if (node.type === "CODE_BLOCK") {
        if (params.fontSize !== undefined) {
          throw new Error("CODE_BLOCK nodes do not support fontSize");
        }
        await loadCodeBlockFont();
        if (params.text !== undefined) node.code = params.text;
        return serializeNode(node);
      }
      const textNode = getEditableTextNode(node);
      if (!textNode) {
        throw new Error(
          `Node ${params.nodeId} (${node.type}) has no editable text`,
        );
      }
      await loadTextFonts(textNode);
      if (params.text !== undefined) textNode.characters = params.text;
      if (params.fontSize !== undefined) textNode.fontSize = params.fontSize;
      return serializeNode(node);
    }

    case "update_table": {
      const node = await requireNode(params.nodeId);
      if (node.type !== "TABLE") {
        throw new Error(
          `Node ${params.nodeId} is not a TABLE (got ${node.type})`,
        );
      }
      switch (params.action) {
        case "INSERT_ROW":
          node.insertRow(requireNumber(params.rowIndex, "rowIndex"));
          break;
        case "INSERT_COLUMN":
          node.insertColumn(requireNumber(params.columnIndex, "columnIndex"));
          break;
        case "REMOVE_ROW":
          node.removeRow(requireNumber(params.rowIndex, "rowIndex"));
          break;
        case "REMOVE_COLUMN":
          node.removeColumn(requireNumber(params.columnIndex, "columnIndex"));
          break;
        case "MOVE_ROW":
          node.moveRow(
            requireNumber(params.fromIndex, "fromIndex"),
            requireNumber(params.toIndex, "toIndex"),
          );
          break;
        case "MOVE_COLUMN":
          node.moveColumn(
            requireNumber(params.fromIndex, "fromIndex"),
            requireNumber(params.toIndex, "toIndex"),
          );
          break;
        case "RESIZE_ROW":
          node.resizeRow(
            requireNumber(params.rowIndex, "rowIndex"),
            requireNumber(params.height, "height"),
          );
          break;
        case "RESIZE_COLUMN":
          node.resizeColumn(
            requireNumber(params.columnIndex, "columnIndex"),
            requireNumber(params.width, "width"),
          );
          break;
        default:
          throw new Error(`Unsupported table action: ${params.action}`);
      }
      return serializeNode(node);
    }

    // ## Create commands

    case "create_node": {
      const { node, attachToParent, selectable } =
        await createNodeFromParams(params);
      if (attachToParent) {
        const parent = params.parentId
          ? await figma.getNodeByIdAsync(params.parentId)
          : getDefaultParent();
        if (!parent || !("appendChild" in parent)) {
          throw new Error("Parent node not found or cannot have children");
        }
        parent.appendChild(node);
      }

      if (params.name !== undefined) node.name = params.name;
      setSupportedProperty(node, "x", params.x);
      setSupportedProperty(node, "y", params.y);
      if (params.width !== undefined && params.height !== undefined) {
        if (!("resize" in node)) {
          throw new Error(`${node.type} nodes cannot be resized`);
        }
        node.resize(params.width, params.height);
      }

      if (selectable) {
        figma.currentPage.selection = [node];
        figma.viewport.scrollAndZoomIntoView([node]);
      }
      return serializeNode(node);
    }

    // ## Delete commands

    case "delete_node": {
      const node = await requireNode(params.nodeId);
      const serialized = serializeNode(node);
      node.remove();
      return { deleted: serialized };
    }

    case "clone_node": {
      const node = await requireNode(params.nodeId);
      if (!("clone" in node)) throw new Error("Node cannot be cloned");
      const clone = node.clone();

      if (params.parentId) {
        const parent = await safeGetNodeById(params.parentId);
        if (!parent || !("appendChild" in parent)) {
          throw new Error("Target parent not found or cannot have children");
        }
        parent.appendChild(clone);
      }

      if (params.name !== undefined) clone.name = params.name;
      if (params.x !== undefined) clone.x = params.x;
      if (params.y !== undefined) clone.y = params.y;

      figma.currentPage.selection = [clone];
      figma.viewport.scrollAndZoomIntoView([clone]);
      return serializeNode(clone);
    }

    // ## Move commands

    case "move_node": {
      const node = await requireNode(params.nodeId);
      const newParent = await safeGetNodeById(params.parentId);
      if (!newParent || !("appendChild" in newParent)) {
        throw new Error("Target parent not found or cannot have children");
      }
      newParent.appendChild(node);
      if (params.index !== undefined) {
        newParent.insertChild(params.index, node);
      }
      return serializeNode(node);
    }

    // ## Utility commands

    case "select_node": {
      const node = await requireNode(params.nodeId);
      if (node.type === "DOCUMENT" || node.type === "PAGE") {
        throw new Error("Cannot select document or page nodes");
      }
      figma.currentPage.selection = [node];
      figma.viewport.scrollAndZoomIntoView([node]);
      return { success: true };
    }

    case "zoom_to_node": {
      const node = await requireNode(params.nodeId);
      if (node.type === "DOCUMENT" || node.type === "PAGE") {
        throw new Error("Cannot zoom to document or page nodes");
      }
      figma.viewport.scrollAndZoomIntoView([node]);
      return { success: true };
    }

    // ## Instance commands

    case "detach_instance": {
      requireDesignEditor("detach_instance");
      const node = await requireNode(params.nodeId);
      if (node.type !== "INSTANCE") {
        throw new Error(
          `Node ${params.nodeId} is not an INSTANCE (got ${node.type})`,
        );
      }
      const frame = node.detachInstance();
      return serializeNode(frame);
    }

    case "create_instance": {
      requireDesignEditor("create_instance");
      const component = await figma.getNodeByIdAsync(params.componentId);
      if (!component)
        throw new Error(`Component not found: ${params.componentId}`);
      if (component.type !== "COMPONENT") {
        throw new Error(
          `Node ${params.componentId} is not a COMPONENT (got ${component.type}). For a COMPONENT_SET, pass one of its variant children.`,
        );
      }

      const instance = component.createInstance();

      if (params.parentId) {
        const parent = await figma.getNodeByIdAsync(params.parentId);
        if (!parent || !("appendChild" in parent))
          throw new Error("Parent not found or cannot have children");
        parent.appendChild(instance);
      }

      if (params.x !== undefined) instance.x = params.x;
      if (params.y !== undefined) instance.y = params.y;
      if (params.name !== undefined) instance.name = params.name;

      // ## Apply instance properties
      if (params.properties && Object.keys(params.properties).length > 0) {
        instance.setProperties(params.properties);
      }

      figma.currentPage.selection = [instance];
      figma.viewport.scrollAndZoomIntoView([instance]);
      return serializeNode(instance);
    }

    // ## Full node reads

    case "get_node_full": {
      const node = await safeGetNodeById(params.nodeId);
      if (!node) throw new Error(`Node not found: ${params.nodeId}`);
      return serializeNodeFull(node);
    }

    // ## Layout commands

    case "set_layout": {
      const node = await requireNode(params.nodeId);
      if (!("layoutMode" in node))
        throw new Error(
          "Node does not support auto-layout (must be a frame or component)",
        );
      const p = params;
      const originalWidth = node.width;
      const originalHeight = node.height;
      // ## Set layout mode first
      if (p.layoutMode !== undefined) node.layoutMode = p.layoutMode;
      if (p.primaryAxisAlignItems !== undefined)
        node.primaryAxisAlignItems = p.primaryAxisAlignItems;
      if (p.counterAxisAlignItems !== undefined)
        node.counterAxisAlignItems = p.counterAxisAlignItems;
      if (p.primaryAxisSizingMode !== undefined)
        node.primaryAxisSizingMode = p.primaryAxisSizingMode;
      if (p.counterAxisSizingMode !== undefined)
        node.counterAxisSizingMode = p.counterAxisSizingMode;
      if (p.paddingTop !== undefined) node.paddingTop = p.paddingTop;
      if (p.paddingRight !== undefined) node.paddingRight = p.paddingRight;
      if (p.paddingBottom !== undefined) node.paddingBottom = p.paddingBottom;
      if (p.paddingLeft !== undefined) node.paddingLeft = p.paddingLeft;
      if (p.itemSpacing !== undefined) node.itemSpacing = p.itemSpacing;

      // ## Preserve dimensions requested as fixed
      if ("resize" in node && node.layoutMode !== "NONE") {
        let width = node.width;
        let height = node.height;
        if (node.layoutMode === "HORIZONTAL") {
          if (p.primaryAxisSizingMode === "FIXED") width = originalWidth;
          if (p.counterAxisSizingMode === "FIXED") height = originalHeight;
        } else {
          if (p.primaryAxisSizingMode === "FIXED") height = originalHeight;
          if (p.counterAxisSizingMode === "FIXED") width = originalWidth;
        }
        node.resize(width, height);
      }
      return serializeNodeFull(node);
    }

    case "get_component_properties": {
      requireDesignEditor("get_component_properties");
      const node = await requireNode(params.nodeId);
      if (!("componentPropertyDefinitions" in node)) {
        throw new Error("Node has no componentPropertyDefinitions");
      }
      return node.componentPropertyDefinitions;
    }

    case "get_component_set_summary": {
      requireDesignEditor("get_component_set_summary");
      const node = await requireComponentSet(params.nodeId);
      return serializeComponentSetSummary(node);
    }

    case "reorder_variant_options": {
      // ## Reorder variant options
      requireDesignEditor("reorder_variant_options");
      const node = await requireNode(params.nodeId);
      if (!("componentPropertyDefinitions" in node)) {
        throw new Error("Node has no componentPropertyDefinitions");
      }
      const defs = node.componentPropertyDefinitions;
      if (!defs[params.property]) {
        throw new Error(`Property "${params.property}" not found`);
      }
      node.editComponentProperty(params.property, {
        variantOptions: params.order,
      });
      return node.componentPropertyDefinitions[params.property];
    }

    case "create_component_set": {
      requireDesignEditor("create_component_set");
      const ids = params.componentIds || [];
      if (!Array.isArray(ids) || ids.length === 0) {
        throw new Error("componentIds must contain at least one COMPONENT id");
      }

      const components = [];
      for (const id of ids) {
        const node = await safeGetNodeById(id);
        if (!node) throw new Error(`Component not found: ${id}`);
        if (node.type !== "COMPONENT") {
          throw new Error(`Node ${id} is not a COMPONENT (got ${node.type})`);
        }
        components.push(node);
      }

      const parent = params.parentId
        ? await safeGetNodeById(params.parentId)
        : components[0].parent;
      if (!parent || !("appendChild" in parent)) {
        throw new Error("Parent node not found or cannot have children");
      }

      const set = figma.combineAsVariants(components, parent);
      if (params.name !== undefined) set.name = params.name;
      if (params.x !== undefined) set.x = params.x;
      if (params.y !== undefined) set.y = params.y;

      figma.currentPage.selection = [set];
      figma.viewport.scrollAndZoomIntoView([set]);
      return serializeComponentSetSummary(set);
    }

    // ## Script execution

    case "run_script": {
      // ## Use the real figma object
      const fn = new Function(
        "figma",
        "safeGetNodeById",
        `"use strict"; return (async () => { ${params.code} })()`,
      );
      return await fn(figma, safeGetNodeById);
    }

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

// ## Helper functions

async function createNodeFromParams(params) {
  const type = (params.type || "").toUpperCase();
  let node;
  let attachToParent = true;
  let selectable = true;

  switch (type) {
    case "RECTANGLE":
      node = figma.createRectangle();
      break;
    case "ELLIPSE":
      node = figma.createEllipse();
      break;
    case "FRAME":
      node = figma.createFrame();
      break;
    case "TEXT":
      node = figma.createText();
      await figma.loadFontAsync({ family: "Inter", style: "Regular" });
      node.characters = params.text || "";
      break;
    case "STICKY":
      requireEditor("create STICKY", ["figjam"]);
      node = figma.createSticky();
      await loadTextFonts(node.text);
      node.text.characters = params.text || "";
      break;
    case "SHAPE_WITH_TEXT":
      requireEditor("create SHAPE_WITH_TEXT", ["figjam"]);
      node = figma.createShapeWithText();
      if (params.shapeType !== undefined) node.shapeType = params.shapeType;
      await loadTextFonts(node.text);
      node.text.characters = params.text || "";
      break;
    case "CONNECTOR": {
      requireEditor("create CONNECTOR", ["figjam"]);
      node = figma.createConnector();
      if (params.connectorLineType !== undefined) {
        node.connectorLineType = params.connectorLineType;
      }
      const magnet = node.connectorLineType === "STRAIGHT" ? "CENTER" : "AUTO";
      if (params.startNodeId) {
        node.connectorStart = { endpointNodeId: params.startNodeId, magnet };
      }
      if (params.endNodeId) {
        node.connectorEnd = { endpointNodeId: params.endNodeId, magnet };
      }
      if (params.text !== undefined) {
        await loadTextFonts(node.text);
        node.text.characters = params.text;
      }
      break;
    }
    case "CODE_BLOCK":
      requireEditor("create CODE_BLOCK", ["figjam"]);
      node = figma.createCodeBlock();
      await loadCodeBlockFont();
      node.code = params.code || "";
      if (params.codeLanguage !== undefined) {
        node.codeLanguage = params.codeLanguage;
      }
      break;
    case "TABLE":
      requireEditor("create TABLE", ["figjam"]);
      node = figma.createTable(params.rows, params.columns);
      break;
    case "SECTION":
      requireEditor("create SECTION", ["figjam"]);
      node = figma.createSection();
      break;
    case "SLIDE":
      requireEditor("create SLIDE", ["slides"]);
      node = figma.createSlide(params.row, params.column);
      attachToParent = false;
      break;
    case "SLIDE_ROW":
      requireEditor("create SLIDE_ROW", ["slides"]);
      node = figma.createSlideRow(params.row);
      attachToParent = false;
      selectable = false;
      break;
    default:
      throw new Error(`Unsupported node type: ${params.type}`);
  }

  return { node, attachToParent, selectable };
}

function getPluginContext() {
  const context = {
    editorType: figma.editorType,
    page: { id: figma.currentPage.id, name: figma.currentPage.name },
    selectionCount: figma.currentPage.selection.length,
  };
  if (figma.editorType === "slides") {
    const focusedSlide = figma.currentPage.focusedSlide;
    context.focusedSlide = focusedSlide
      ? { id: focusedSlide.id, name: focusedSlide.name }
      : null;
    context.slidesMode = figma.viewport.slidesMode;
  }
  return context;
}

function getDefaultParent() {
  if (figma.editorType !== "slides") return figma.currentPage;
  const slide = figma.currentPage.focusedSlide;
  if (!slide) {
    throw new Error("No focused slide. Focus a slide or provide parentId.");
  }
  return slide;
}

function requireEditor(operation, editorTypes) {
  if (!editorTypes.includes(figma.editorType)) {
    throw new Error(
      `${operation} is only available in ${editorTypes.join(" or ")}`,
    );
  }
}

function requireDesignEditor(command) {
  requireEditor(command, ["figma"]);
}

function setSupportedProperty(node, property, value) {
  if (value === undefined) return;
  if (!(property in node)) {
    throw new Error(`${node.type} nodes do not support ${property}`);
  }
  node[property] = value;
}

function requireNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

function getEditableTextNode(node) {
  if (node.type === "TEXT") return node;
  if ("text" in node && node.text && "characters" in node.text) {
    return node.text;
  }
  return null;
}

async function loadTextFonts(textNode) {
  const fonts = new Map();
  if ("getStyledTextSegments" in textNode) {
    for (const segment of textNode.getStyledTextSegments(["fontName"])) {
      const font = segment.fontName;
      if (isUsableFont(font)) {
        fonts.set(`${font.family}::${font.style}`, font);
      }
    }
  }
  if (fonts.size === 0 && isUsableFont(textNode.fontName)) {
    const font = textNode.fontName;
    fonts.set(`${font.family}::${font.style}`, font);
  }
  if (fonts.size === 0) {
    const fallback = { family: "Inter", style: "Regular" };
    await figma.loadFontAsync(fallback);
    textNode.fontName = fallback;
    return;
  }
  for (const font of fonts.values()) await figma.loadFontAsync(font);
}

function isUsableFont(font) {
  return (
    font &&
    font !== figma.mixed &&
    typeof font.family === "string" &&
    font.family.length > 0 &&
    typeof font.style === "string" &&
    font.style.length > 0
  );
}

async function loadCodeBlockFont() {
  await figma.loadFontAsync({ family: "Source Code Pro", style: "Medium" });
}

async function safeGetNodeById(id) {
  // ## Resolve compound instance ids
  if (typeof id === "string" && id.includes(";")) {
    const node = figma.currentPage.findOne((n) => n.id === id);
    if (node) return node;
    // ## Fallback to async lookup
  }
  return figma.getNodeByIdAsync(id);
}

async function requireNode(nodeId) {
  const node = await safeGetNodeById(nodeId);
  if (!node) throw new Error(`Node not found: ${nodeId}`);
  return node;
}

async function requireComponentSet(nodeId) {
  const node = await requireNode(nodeId);
  if (node.type !== "COMPONENT_SET") {
    throw new Error(`Node ${nodeId} is not a COMPONENT_SET (got ${node.type})`);
  }
  return node;
}

function serializeComponentSetSummary(node) {
  const out = serializeNodeFull(node);
  out.variantGroupProperties = node.variantGroupProperties;
  out.componentPropertyDefinitions = node.componentPropertyDefinitions;
  out.variants = node.children.map((child) => {
    const variant = serializeNodeFull(child);
    if ("variantProperties" in child && child.variantProperties) {
      variant.variantProperties = child.variantProperties;
    }
    return variant;
  });
  return out;
}

function serializeNodeFull(node) {
  const out = serializeNode(node);

  // ## Constraints
  if ("constraints" in node) {
    out.constraints = node.constraints;
  }

  // ## Auto layout props
  if ("layoutMode" in node) {
    out.layoutMode = node.layoutMode;
    out.primaryAxisSizingMode = node.primaryAxisSizingMode;
    out.counterAxisSizingMode = node.counterAxisSizingMode;
    out.paddingTop = node.paddingTop;
    out.paddingRight = node.paddingRight;
    out.paddingBottom = node.paddingBottom;
    out.paddingLeft = node.paddingLeft;
    if (node.layoutMode !== "NONE") {
      out.primaryAxisAlignItems = node.primaryAxisAlignItems;
      out.counterAxisAlignItems = node.counterAxisAlignItems;
      out.itemSpacing = node.itemSpacing;
    }
  }

  // ## Size constraints
  if ("minWidth" in node && node.minWidth !== null)
    out.minWidth = node.minWidth;
  if ("maxWidth" in node && node.maxWidth !== null)
    out.maxWidth = node.maxWidth;
  if ("minHeight" in node && node.minHeight !== null)
    out.minHeight = node.minHeight;
  if ("maxHeight" in node && node.maxHeight !== null)
    out.maxHeight = node.maxHeight;

  // ## Clip content
  if ("clipsContent" in node) out.clipsContent = node.clipsContent;

  // ## Locked state
  if ("locked" in node) out.locked = node.locked;

  return out;
}

function serializeNode(node) {
  const out = {
    id: node.id,
    name: node.name,
    type: node.type,
  };
  if ("x" in node) out.x = node.x;
  if ("y" in node) out.y = node.y;
  if ("width" in node) out.width = node.width;
  if ("height" in node) out.height = node.height;
  if ("opacity" in node) out.opacity = node.opacity;
  if ("visible" in node) out.visible = node.visible;
  if ("rotation" in node) out.rotation = node.rotation;

  const textNode = getEditableTextNode(node);
  if (textNode) {
    const key = node.type === "TEXT" ? "characters" : "text";
    out[key] = textNode.characters;
    out.fontSize = textNode.fontSize;
  }

  if (node.type === "STICKY") {
    out.authorVisible = node.authorVisible;
    out.authorName = node.authorName;
    out.isWideWidth = node.isWideWidth;
  } else if (node.type === "SHAPE_WITH_TEXT") {
    out.shapeType = node.shapeType;
  } else if (node.type === "CONNECTOR") {
    out.connectorLineType = node.connectorLineType;
    out.connectorStart = node.connectorStart;
    out.connectorEnd = node.connectorEnd;
    out.connectorStartStrokeCap = node.connectorStartStrokeCap;
    out.connectorEndStrokeCap = node.connectorEndStrokeCap;
  } else if (node.type === "CODE_BLOCK") {
    out.code = node.code;
    out.codeLanguage = node.codeLanguage;
  } else if (node.type === "TABLE") {
    out.numRows = node.numRows;
    out.numColumns = node.numColumns;
  } else if (node.type === "TABLE_CELL") {
    out.rowIndex = node.rowIndex;
    out.columnIndex = node.columnIndex;
  } else if (node.type === "SECTION") {
    out.sectionContentsHidden = node.sectionContentsHidden;
  } else if (node.type === "SLIDE") {
    out.isSkippedSlide = node.isSkippedSlide;
    out.slideTransition = node.getSlideTransition();
  } else if (node.type === "INTERACTIVE_SLIDE_ELEMENT") {
    out.interactiveSlideElementType = node.interactiveSlideElementType;
  }

  if ("fills" in node && node.fills !== figma.mixed) {
    out.fills = node.fills;
  }
  if ("children" in node) {
    out.childCount = node.children.length;
  }
  return out;
}
