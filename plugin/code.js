// ## Main thread bridge

figma.showUI(__html__, {
  width: 220,
  height: 120,
  title: "Pi Labor",
  themeColors: true,
});

figma.ui.onmessage = async (msg) => {
  if (msg.type === "resize") {
    figma.ui.resize(220, msg.height);
    return;
  }

  const { id, command, params } = msg;
  try {
    const result = await executeCommand(command, params);
    figma.ui.postMessage({ id, result });
  } catch (err) {
    figma.ui.postMessage({ id, error: err.message });
  }
};

async function executeCommand(command, params) {
  switch (command) {
    // ## Undo commands

    case "undo": {
      figma.undo();
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
      if (p.x !== undefined) node.x = p.x;
      if (p.y !== undefined) node.y = p.y;
      if (p.opacity !== undefined) node.opacity = p.opacity;
      if (p.visible !== undefined) node.visible = p.visible;
      if (p.rotation !== undefined) node.rotation = p.rotation;
      if (
        (p.width !== undefined || p.height !== undefined) &&
        "resize" in node
      ) {
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
      if (node.type !== "TEXT")
        throw new Error(`Node ${params.nodeId} is not a text node`);
      await figma.loadFontAsync(node.fontName);
      if (params.text !== undefined) node.characters = params.text;
      if (params.fontSize !== undefined) node.fontSize = params.fontSize;
      return serializeNode(node);
    }

    // ## Create commands

    case "create_node": {
      const parent = params.parentId
        ? await figma.getNodeByIdAsync(params.parentId)
        : figma.currentPage;
      if (!parent || !("appendChild" in parent)) {
        throw new Error("Parent node not found or cannot have children");
      }

      let node;
      switch ((params.type || "").toUpperCase()) {
        case "RECTANGLE":
          node = figma.createRectangle();
          break;
        case "ELLIPSE":
          node = figma.createEllipse();
          break;
        case "FRAME":
          node = figma.createFrame();
          break;
        case "TEXT": {
          node = figma.createText();
          await figma.loadFontAsync({ family: "Inter", style: "Regular" });
          node.characters = params.text || "";
          break;
        }
        default:
          throw new Error(`Unsupported node type: ${params.type}`);
      }

      parent.appendChild(node);
      if (params.name !== undefined) node.name = params.name;
      if (params.x !== undefined) node.x = params.x;
      if (params.y !== undefined) node.y = params.y;
      if (
        params.width !== undefined &&
        params.height !== undefined &&
        "resize" in node
      ) {
        node.resize(params.width, params.height);
      }

      figma.currentPage.selection = [node];
      figma.viewport.scrollAndZoomIntoView([node]);
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
      return serializeNodeFull(node);
    }

    case "get_component_properties": {
      const node = await requireNode(params.nodeId);
      if (!("componentPropertyDefinitions" in node)) {
        throw new Error("Node has no componentPropertyDefinitions");
      }
      return node.componentPropertyDefinitions;
    }

    case "get_component_set_summary": {
      const node = await requireComponentSet(params.nodeId);
      return serializeComponentSetSummary(node);
    }

    case "reorder_variant_options": {
      // ## Reorder variant options
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
  if (node.type === "TEXT") {
    out.characters = node.characters;
    out.fontSize = node.fontSize;
  }
  if ("fills" in node && node.fills !== figma.mixed) {
    out.fills = node.fills;
  }
  if ("children" in node) {
    out.childCount = node.children.length;
  }
  return out;
}
