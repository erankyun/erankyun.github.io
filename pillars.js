const SVG_NS = "http://www.w3.org/2000/svg";

const PART_SOURCES = {
  capital: { file: "pillar1capital.svg", x: 0, y: 0 },
  shaft: { file: "pillar1shaft.svg", x: 9.2637746 },
  base: { file: "pillar1base.svg", x: 1.7636811 },
};

// These offsets align the visible connector vertices, not the viewBox edges.
const CAPITAL_BOTTOM_Y = 106.5;
const SHAFT_TOP_Y = 0.4999972;
const SHAFT_BOTTOM_Y = 45.499997;
const BASE_TOP_Y = 0.49998369;
const SHAFT_START_Y = CAPITAL_BOTTOM_Y - SHAFT_TOP_Y;
const SHAFT_STEP = SHAFT_BOTTOM_Y - SHAFT_TOP_Y;

const createSvgElement = (name, attributes = {}) => {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
};

function parsePart(name, source, text) {
  const xml = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = xml.documentElement;
  if (root.localName !== "svg" || xml.querySelector("parsererror")) {
    throw new Error(`Could not parse pillar component: ${source.file}`);
  }

  const viewBox = root.getAttribute("viewBox");
  const values = viewBox?.trim().split(/[\s,]+/).map(Number);
  if (!values || values.length !== 4 || values[0] !== 0 || values[1] !== 0) {
    throw new Error(`Unexpected viewBox in pillar component: ${source.file}`);
  }

  return {
    name,
    file: source.file,
    x: source.x,
    viewBox,
    width: values[2],
    height: values[3],
    root,
  };
}

export async function loadPillarParts(assetBase) {
  const entries = await Promise.all(
    Object.entries(PART_SOURCES).map(async ([name, source]) => {
      const response = await fetch(`${assetBase}${source.file}`);
      if (!response.ok) {
        throw new Error(`Could not load pillar component: ${source.file}`);
      }
      return [name, parsePart(name, source, await response.text())];
    }),
  );
  return Object.fromEntries(entries);
}

export function getPillarHeight(parts, shaftRepeats) {
  const baseY = CAPITAL_BOTTOM_Y + shaftRepeats * SHAFT_STEP - BASE_TOP_Y;
  return baseY + parts.base.height;
}

export function fitPillarToHeight(parts, targetHeight, preferredWidth) {
  const fixedHeight = getPillarHeight(parts, 0);
  const preferredScale = preferredWidth / parts.capital.width;
  const idealRepeats =
    (targetHeight / preferredScale - fixedHeight) / SHAFT_STEP;
  const center = Math.max(0, Math.round(idealRepeats));
  const candidates = new Set(
    [0, center - 1, center, center + 1, center + 2].filter((count) => count >= 0),
  );

  let best;
  for (const shaftRepeats of candidates) {
    const viewBoxHeight = getPillarHeight(parts, shaftRepeats);
    const scale = targetHeight / viewBoxHeight;
    const width = parts.capital.width * scale;
    const distance = Math.abs(width - preferredWidth);
    if (!best || distance < best.distance) {
      best = {
        shaftRepeats,
        viewBoxHeight,
        scale,
        width,
        height: targetHeight,
        distance,
      };
    }
  }
  return best;
}

export function fitPillarToContent(parts, contentHeight, preferredWidth) {
  const scale = preferredWidth / parts.capital.width;
  const fixedHeight = getPillarHeight(parts, 0);
  const neededViewBoxHeight = contentHeight / scale;
  const shaftRepeats = Math.max(
    0,
    Math.ceil((neededViewBoxHeight - fixedHeight - 1e-6) / SHAFT_STEP),
  );
  const viewBoxHeight = getPillarHeight(parts, shaftRepeats);

  return {
    shaftRepeats,
    viewBoxHeight,
    scale,
    width: preferredWidth,
    height: viewBoxHeight * scale,
  };
}

export function fitPillarBelowHeight(parts, maximumHeight, preferredWidth) {
  const scale = preferredWidth / parts.capital.width;
  const fixedHeight = getPillarHeight(parts, 0);
  const maximumViewBoxHeight = maximumHeight / scale;
  const shaftRepeats = Math.max(
    0,
    Math.floor((maximumViewBoxHeight - fixedHeight + 1e-6) / SHAFT_STEP),
  );
  const viewBoxHeight = getPillarHeight(parts, shaftRepeats);

  return {
    shaftRepeats,
    viewBoxHeight,
    scale,
    width: preferredWidth,
    height: viewBoxHeight * scale,
  };
}

function cloneVectorArtwork(part, prefix) {
  const group = createSvgElement("g", { stroke: "currentColor" });
  const excluded = new Set(["metadata", "image", "title", "desc"]);

  for (const child of part.root.children) {
    if (child.namespaceURI !== SVG_NS || excluded.has(child.localName)) continue;
    group.append(document.importNode(child, true));
  }

  const nodes = [group, ...group.querySelectorAll("*")];
  const idMap = new Map();
  for (const node of nodes) {
    if (node.id) idMap.set(node.id, `${prefix}-${node.id}`);
  }

  for (const node of nodes) {
    const style = node.getAttribute("style");
    if (style) {
      node.setAttribute(
        "style",
        style.replace(/(^|;)\s*stroke\s*:\s*[^;]+/gi, "$1stroke:currentColor"),
      );
    }
    if (node.hasAttribute("stroke")) {
      node.setAttribute("stroke", "currentColor");
    }

    for (const attribute of [...node.attributes]) {
      let value = attribute.value;
      if (attribute.name === "id") {
        value = idMap.get(value) || `${prefix}-${value}`;
      } else {
        value = value.replace(/url\(#([^)]+)\)/g, (_match, id) => {
          return `url(#${idMap.get(id) || id})`;
        });
        if (/^(?:xlink:)?href$/i.test(attribute.name) && value.startsWith("#")) {
          const id = value.slice(1);
          value = `#${idMap.get(id) || id}`;
        }
      }
      if (value !== attribute.value) {
        if (attribute.namespaceURI) {
          node.setAttributeNS(attribute.namespaceURI, attribute.name, value);
        } else {
          node.setAttribute(attribute.name, value);
        }
      }
    }
  }

  return group;
}

function addPart(svg, part, x, y, prefix) {
  const viewport = createSvgElement("svg", {
    x,
    y,
    width: part.width,
    height: part.height,
    viewBox: part.viewBox,
    preserveAspectRatio: "none",
    overflow: "hidden",
  });
  viewport.append(cloneVectorArtwork(part, prefix));
  svg.append(viewport);
}

export function buildPillarSvg(parts, shaftRepeats, panelIndex) {
  const baseY = CAPITAL_BOTTOM_Y + shaftRepeats * SHAFT_STEP - BASE_TOP_Y;
  const height = getPillarHeight(parts, shaftRepeats);
  const svg = createSvgElement("svg", {
    viewBox: `0 0 ${parts.capital.width} ${height}`,
    preserveAspectRatio: "xMinYMin meet",
    "aria-hidden": "true",
    focusable: "false",
    class: "panel__pillar-svg",
  });

  addPart(svg, parts.capital, PART_SOURCES.capital.x, 0, `p${panelIndex}-cap`);
  for (let index = 0; index < shaftRepeats; index += 1) {
    addPart(
      svg,
      parts.shaft,
      PART_SOURCES.shaft.x,
      SHAFT_START_Y + index * SHAFT_STEP,
      `p${panelIndex}-shaft${index}`,
    );
  }
  addPart(svg, parts.base, PART_SOURCES.base.x, baseY, `p${panelIndex}-base`);

  return svg;
}
