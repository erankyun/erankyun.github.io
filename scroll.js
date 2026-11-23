const moduleUrl = new URL(import.meta.url);
const pillarUrl = new URL("./pillars.js", moduleUrl);
const moduleVersion = moduleUrl.searchParams.get("v");
if (moduleVersion) pillarUrl.searchParams.set("v", moduleVersion);

const {
  buildPillarSvg,
  fitPillarBelowHeight,
  fitPillarToContent,
  getPillarHeight,
  loadPillarParts,
} = await import(pillarUrl.href);

const assetScript = document.querySelector("script[data-pillar-assets]");
const assetBase = assetScript?.dataset.pillarAssets || "../pillar1/";
const pageShell = document.querySelector("#page-scroll");
const pageGrid = document.querySelector(".page-grid");
const progress = document.querySelector("#scroll-progress");
const progressTrack = document.querySelector("#scroll-progress-track");
const progressWalker = progress?.querySelector(".scroll-progress__walker");
const progressScrubber = progress?.querySelector(".scroll-progress__scrubber");
const sectionLabels = document.querySelector("#scroll-progress-sections");
const themeToggle = document.querySelector("[data-theme-toggle]");
const themeMeta = document.querySelector('meta[name="theme-color"]');
const desktopQuery = window.matchMedia("(min-width: 700px)");
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const panels = [...document.querySelectorAll(".panel")];
const pixel = (value) => Number.parseFloat(value) || 0;
let pillarParts;

function currentTheme() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function applyTheme(theme, persist = false) {
  const isLight = theme === "light";
  document.documentElement.dataset.theme = isLight ? "light" : "dark";
  themeMeta?.setAttribute("content", isLight ? "#F4EFE6" : "#100C08");

  if (themeToggle) {
    themeToggle.setAttribute("aria-pressed", String(isLight));
    const label = isLight ? "Switch to dark mode" : "Switch to light mode";
    themeToggle.setAttribute("aria-label", label);
    themeToggle.setAttribute("title", label);
  }

  if (persist) {
    try {
      localStorage.setItem("theme", theme);
    } catch {
      // Storage can be unavailable in private or restricted contexts.
    }
  }
}

function toggleTheme() {
  applyTheme(currentTheme() === "light" ? "dark" : "light", true);
}

const states = panels.map((panel, index) => ({
  panel,
  index,
  heading: panel.querySelector(".panel__heading"),
  body: panel.querySelector(".panel__body"),
  art: panel.querySelector(".panel__pillar"),
  copy: panel.querySelector(".panel__copy"),
}));

function resetState(state) {
  const { panel, body, art, copy } = state;
  panel.style.removeProperty("--panel-width");
  panel.style.removeProperty("--pillar-line-width");
  body.style.removeProperty("height");
  body.style.removeProperty("--pillar-copy-offset");
  art.style.removeProperty("width");
  art.style.removeProperty("height");
  copy.style.removeProperty("margin-inline-start");
  copy.style.removeProperty("width");
  copy.style.removeProperty("height");
  copy.style.removeProperty("column-count");
  copy.style.removeProperty("column-width");
  copy.style.removeProperty("column-gap");
  copy.style.removeProperty("column-fill");
  copy.style.removeProperty("--column-step");
  copy.style.removeProperty("--divider-offset");
  body.classList.add("has-pillar");
}

function preferredArtWidth(art) {
  return art.getBoundingClientRect().width;
}

function setCopyOffset(state, artWidth) {
  const { body, art } = state;
  const bodyStyle = getComputedStyle(body);
  const artLeft = pixel(getComputedStyle(art).left);
  const bodyPaddingLeft = pixel(bodyStyle.paddingLeft);
  const gapProbe = document.createElement("span");
  gapProbe.style.cssText =
    "position:absolute;display:block;width:var(--pillar-copy-gap);height:0;padding:0;border:0;visibility:hidden;pointer-events:none";
  body.append(gapProbe);
  const gap = gapProbe.getBoundingClientRect().width;
  gapProbe.remove();

  const offset = Math.max(0, artLeft + artWidth + gap - bodyPaddingLeft);
  body.style.setProperty("--pillar-copy-offset", `${offset}px`);
}

function paintPillar(state, fit, desktop) {
  const { panel, body, art, index } = state;
  panel.style.setProperty("--pillar-line-width", `${fit.scale}px`);
  art.style.width = `${fit.width}px`;
  art.style.height = `${fit.height}px`;
  body.dataset.shaftRepeats = String(fit.shaftRepeats);
  body.dataset.pillarHeight = String(fit.viewBoxHeight);

  if (
    art.dataset.shaftRepeats !== String(fit.shaftRepeats) ||
    !art.firstElementChild
  ) {
    art.replaceChildren(buildPillarSvg(pillarParts, fit.shaftRepeats, index));
    art.dataset.shaftRepeats = String(fit.shaftRepeats);
  }

  setCopyOffset(state, fit.width);
  if (!desktop) body.style.height = `${fit.height}px`;
}

function desktopBodySizing(state) {
  const { panel, body, copy, heading } = state;
  const bodyStyle = getComputedStyle(body);
  const columnWidth = measureColumnWidth(copy);
  const naturalCopyHeight = measureCopyHeight(state, columnWidth);
  const verticalPadding =
    pixel(bodyStyle.paddingTop) + pixel(bodyStyle.paddingBottom);
  const naturalBodyHeight = naturalCopyHeight + verticalPadding;
  const panelStyle = getComputedStyle(panel);
  const headingHeight = heading.getBoundingClientRect().height;
  const availableBodyHeight = Math.max(
    1,
    pageGrid.clientHeight - headingHeight - pixel(panelStyle.borderTopWidth),
  );
  const preferredWidth = preferredArtWidth(state.art);
  const scale = preferredWidth / pillarParts.capital.width;
  const minimumBodyHeight = getPillarHeight(pillarParts, 0) * scale;
  const desiredBodyHeight = Math.max(naturalBodyHeight, minimumBodyHeight);
  let fit = fitPillarToContent(pillarParts, desiredBodyHeight, preferredWidth);

  if (fit.height > availableBodyHeight) {
    fit = fitPillarBelowHeight(pillarParts, availableBodyHeight, preferredWidth);
  }

  return {
    fit,
    targetCopyHeight: Math.max(1, fit.height - verticalPadding),
  };
}

function applyDesktopPillar(state, fit) {
  const { body } = state;
  if (!fit || fit.width <= 0 || fit.height <= 0) return;
  body.style.height = `${fit.height}px`;
  paintPillar(state, fit, true);
}

function fitMobilePillar(state) {
  const { panel, body, art, copy } = state;
  const preferredWidth = preferredArtWidth(art);
  if (preferredWidth <= 0) return;

  const scale = preferredWidth / pillarParts.capital.width;
  panel.style.setProperty("--pillar-line-width", `${scale}px`);
  setCopyOffset(state, preferredWidth);

  const bodyStyle = getComputedStyle(body);
  const verticalPadding = pixel(bodyStyle.paddingTop) + pixel(bodyStyle.paddingBottom);
  const contentHeight = copy.getBoundingClientRect().height + verticalPadding;
  paintPillar(
    state,
    fitPillarToContent(pillarParts, contentHeight, preferredWidth),
    false,
  );
}

function measureColumnWidth(copy) {
  const style = getComputedStyle(copy);
  const ruler = document.createElement("span");
  ruler.style.cssText = [
    "position:fixed",
    "left:-100000px",
    "top:0",
    "display:block",
    "height:0",
    "padding:0",
    "border:0",
    "white-space:nowrap",
    "visibility:hidden",
    "width:65ch",
    `font-family:${style.fontFamily}`,
    `font-size:${style.fontSize}`,
    `font-weight:${style.fontWeight}`,
    `font-style:${style.fontStyle}`,
    `letter-spacing:${style.letterSpacing}`,
  ].join(";");
  document.body.append(ruler);
  const width = ruler.getBoundingClientRect().width;
  ruler.remove();
  return width;
}

function measureCopyHeight(state, columnWidth) {
  const probe = state.copy.cloneNode(true);
  probe.removeAttribute("id");
  probe.classList.add("panel__copy--measure");
  probe.style.width = `${columnWidth}px`;
  state.body.append(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return height;
}

function fitColumns(state, targetCopyHeight) {
  const { panel, body, copy, heading } = state;
  const bodyStyle = getComputedStyle(body);
  const availableHeight = Math.max(1, targetCopyHeight);
  const columnWidth = measureColumnWidth(copy);
  const columnGap = pixel(getComputedStyle(copy).columnGap);
  const textHeight = measureCopyHeight(state, columnWidth);
  let columns = Math.max(1, Math.ceil(textHeight / availableHeight));

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const copyWidth = columns * columnWidth + (columns - 1) * columnGap;
    copy.style.width = `${copyWidth}px`;
    copy.style.height = `${availableHeight}px`;
    copy.style.columnCount = String(columns);
    copy.style.columnWidth = `${columnWidth}px`;
    copy.style.columnGap = `${columnGap}px`;
    copy.style.columnFill = "auto";
    copy.style.setProperty("--column-step", `${columnWidth + columnGap}px`);
    copy.style.setProperty("--divider-offset", `${columnWidth + columnGap / 2}px`);

    if (
      copy.scrollWidth <= copy.clientWidth + 2 &&
      copy.scrollHeight <= copy.clientHeight + 2
    ) {
      break;
    }
    columns += 1;
  }

  const bodyStyleAfterLayout = getComputedStyle(body);
  const panelStyle = getComputedStyle(panel);
  const copyOffset = pixel(getComputedStyle(copy).marginInlineStart);
  const frameWidth =
    pixel(panelStyle.borderLeftWidth) + pixel(panelStyle.borderRightWidth);
  const bodyWidth =
    pixel(bodyStyleAfterLayout.paddingLeft) +
    copyOffset +
    copy.getBoundingClientRect().width +
    pixel(bodyStyleAfterLayout.paddingRight) +
    frameWidth;
  const headingText = heading.querySelector("h2");
  const titleRange = document.createRange();
  titleRange.selectNodeContents(headingText);
  const headingStyle = getComputedStyle(heading);
  const titleWidth =
    titleRange.getBoundingClientRect().width +
    pixel(headingStyle.paddingLeft) +
    pixel(headingStyle.paddingRight) +
    pixel(headingStyle.borderLeftWidth) +
    frameWidth;

  panel.style.setProperty(
    "--panel-width",
    `${Math.max(640, bodyWidth, titleWidth)}px`,
  );
  panel.dataset.columnCount = String(columns);
  panel.dataset.columnStep = String(columnWidth + columnGap);
}

function buildSectionLabels() {
  if (!sectionLabels || sectionLabels.children.length) return;

  panels.forEach((panel, index) => {
    const label = document.createElement("button");
    label.type = "button";
    label.className = "scroll-progress__section";
    label.dataset.panelIndex = String(index);
    label.textContent = panel.querySelector("h2")?.textContent.trim() || "";
    sectionLabels.append(label);
  });
}

function sectionProgress(panel) {
  const range = desktopQuery.matches
    ? pageShell.scrollWidth - pageShell.clientWidth
    : document.documentElement.scrollHeight - window.innerHeight;
  if (range <= 0) return 0;

  const offset = desktopQuery.matches
    ? panelStart(panel)
    : panel.getBoundingClientRect().top + window.scrollY;
  return Math.max(0, Math.min(1, offset / range));
}

function positionSectionLabels() {
  if (!sectionLabels) return;

  const width = sectionLabels.getBoundingClientRect().width;
  if (!width) return;

  const edge = 8;
  const gap = 12;
  const entries = panels.map((panel, index) => {
    const element = sectionLabels.children[index];
    const fraction = index === 0 ? 0 : sectionProgress(panel);
    return {
      element,
      target: fraction * width,
      width: element.getBoundingClientRect().width,
      x: 0,
    };
  });

  const sorted = [...entries].sort((a, b) => a.target - b.target);
  let cursor = edge;
  for (const entry of sorted) {
    entry.x = Math.max(entry.target, cursor + entry.width / 2);
    cursor = entry.x + entry.width / 2 + gap;
  }

  cursor = width - edge;
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const entry = sorted[index];
    entry.x = Math.min(entry.x, cursor - entry.width / 2);
    cursor = entry.x - entry.width / 2 - gap;
  }

  for (const entry of entries) {
    entry.x = Math.max(
      edge + entry.width / 2,
      Math.min(width - edge - entry.width / 2, entry.x),
    );
    entry.element.style.left = `${entry.x}px`;
    entry.element.style.transform = "translateX(-50%)";
  }
}

function updateSectionLabels() {
  if (!sectionLabels || !progressWalker) return;

  const walkerRect = progressWalker.getBoundingClientRect();
  for (const label of sectionLabels.children) {
    const labelRect = label.getBoundingClientRect();
    const isUnderWalker =
      walkerRect.right > labelRect.left && walkerRect.left < labelRect.right;
    label.classList.toggle("is-under-walker", isUnderWalker);
  }
}

function layout() {
  const desktop = desktopQuery.matches;
  const previousRange = pageShell.scrollWidth - pageShell.clientWidth;
  const previousProgress =
    previousRange > 0 ? pageShell.scrollLeft / previousRange : 0;

  states.forEach(resetState);
  if (desktop) {
    const sizing = states.map(desktopBodySizing);
    states.forEach((state, index) => {
      applyDesktopPillar(state, sizing[index].fit);
    });
    states.forEach((state, index) => {
      fitColumns(state, sizing[index].targetCopyHeight);
    });
    const nextRange = pageShell.scrollWidth - pageShell.clientWidth;
    pageShell.scrollLeft = previousProgress * Math.max(0, nextRange);
  } else {
    states.forEach(fitMobilePillar);
  }
  positionSectionLabels();
  updateProgress();
}

function scrollBehavior() {
  return reducedMotionQuery.matches ? "auto" : "smooth";
}

function updateProgress() {
  if (!progress || !progressWalker) return;

  const range = desktopQuery.matches
    ? pageShell.scrollWidth - pageShell.clientWidth
    : document.documentElement.scrollHeight - window.innerHeight;
  const position = desktopQuery.matches ? pageShell.scrollLeft : window.scrollY;
  const value = range > 0 ? Math.max(0, Math.min(1, position / range)) : 0;
  progress.style.setProperty("--scroll-progress", `${value * 100}%`);
  progressTrack?.setAttribute("aria-valuenow", String(Math.round(value * 100)));

  const width = progress.getBoundingClientRect().width;
  const walkerWidth = progressWalker.getBoundingClientRect().width;
  const x = Math.max(
    walkerWidth / 2,
    Math.min(width - walkerWidth / 2, value * width),
  );
  progress.style.setProperty("--walker-x", `${x}px`);
  updateSectionLabels();
}

let wheelTarget = null;
let wheelFrame = 0;

function stopWheelAnimation() {
  if (wheelFrame) {
    cancelAnimationFrame(wheelFrame);
    wheelFrame = 0;
  }
  wheelTarget = null;
}

function animateWheelScroll() {
  if (!desktopQuery.matches || wheelTarget === null) {
    stopWheelAnimation();
    return;
  }

  const maximum = pageShell.scrollWidth - pageShell.clientWidth;
  const target = Math.max(0, Math.min(maximum, wheelTarget));
  const distance = target - pageShell.scrollLeft;

  if (Math.abs(distance) < 0.5) {
    pageShell.scrollLeft = target;
    wheelTarget = null;
    wheelFrame = 0;
    return;
  }

  pageShell.scrollLeft += distance * 0.18;
  wheelFrame = requestAnimationFrame(animateWheelScroll);
}

let idleTimer = 0;
function onScroll() {
  updateProgress();
  if (reducedMotionQuery.matches || !progressWalker) return;

  progressWalker.classList.add("is-walking");
  window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    progressWalker.classList.remove("is-walking");
  }, 180);
}

let layoutFrame = 0;
function scheduleLayout() {
  if (layoutFrame) return;
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = 0;
    layout();
  });
}

function handleWheel(event) {
  if (!desktopQuery.matches || event.ctrlKey) return;

  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
    stopWheelAnimation();
    return;
  }
  if (!event.deltaY) return;
  const multiplier =
    event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageShell.clientHeight : 1;
  event.preventDefault();

  if (reducedMotionQuery.matches) {
    pageShell.scrollLeft += event.deltaY * multiplier;
    return;
  }

  const maximum = pageShell.scrollWidth - pageShell.clientWidth;
  const currentTarget = wheelTarget ?? pageShell.scrollLeft;
  wheelTarget = Math.max(
    0,
    Math.min(maximum, currentTarget + event.deltaY * multiplier),
  );

  if (!wheelFrame) {
    wheelFrame = requestAnimationFrame(animateWheelScroll);
  }
}

function panelStart(panel) {
  return (
    panel.getBoundingClientRect().left -
    pageShell.getBoundingClientRect().left +
    pageShell.scrollLeft
  );
}

function activePanel() {
  const position = pageShell.scrollLeft + 1;
  return panels.find((panel) => {
    const left = panelStart(panel);
    return position >= left && position < left + panel.getBoundingClientRect().width;
  }) || panels[0];
}

function handleKeyboard(event) {
  if (!desktopQuery.matches || event.altKey || event.ctrlKey || event.metaKey) return;
  if (
    event.target instanceof Element &&
    event.target.closest("a, button, input, textarea, select, [contenteditable='true']")
  ) {
    return;
  }

  const panel = activePanel();
  const step = pixel(panel?.dataset.columnStep) || pageShell.clientWidth * 0.8;
  const pageStep = pageShell.clientWidth * 0.9;
  const maximum = pageShell.scrollWidth - pageShell.clientWidth;
  let destination;

  switch (event.key) {
    case "ArrowRight":
    case "ArrowDown":
      destination = pageShell.scrollLeft + step;
      break;
    case "ArrowLeft":
    case "ArrowUp":
      destination = pageShell.scrollLeft - step;
      break;
    case "PageDown":
      destination = pageShell.scrollLeft + pageStep;
      break;
    case "PageUp":
      destination = pageShell.scrollLeft - pageStep;
      break;
    case "Home":
      destination = 0;
      break;
    case "End":
      destination = maximum;
      break;
    default:
      return;
  }

  event.preventDefault();
  stopWheelAnimation();
  pageShell.scrollTo({
    left: Math.max(0, Math.min(maximum, destination)),
    behavior: scrollBehavior(),
  });
}

function scrollToPanelIndex(index) {
  const panel = panels[index];
  if (!panel) return;
  stopWheelAnimation();

  if (desktopQuery.matches) {
    pageShell.scrollTo({ left: panelStart(panel), behavior: scrollBehavior() });
  } else {
    window.scrollTo({
      top: panel.getBoundingClientRect().top + window.scrollY,
      behavior: scrollBehavior(),
    });
  }
}

function handleSectionClick(event) {
  if (!(event.target instanceof Element)) return;
  const label = event.target.closest(".scroll-progress__section");
  if (!label) return;
  scrollToPanelIndex(Number(label.dataset.panelIndex));
}

function seekToFraction(fraction) {
  const value = Math.max(0, Math.min(1, fraction));
  stopWheelAnimation();

  if (desktopQuery.matches) {
    const maximum = pageShell.scrollWidth - pageShell.clientWidth;
    pageShell.scrollTo({ left: value * maximum, behavior: scrollBehavior() });
  } else {
    const maximum = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: value * maximum, behavior: scrollBehavior() });
  }
}

function handleScrubberClick(event) {
  const bounds = progress.getBoundingClientRect();
  seekToFraction((event.clientX - bounds.left) / bounds.width);
}

function handleAnchorClick(event) {
  if (!desktopQuery.matches || !(event.target instanceof Element)) return;
  const link = event.target.closest('a[href^="#"]');
  if (!link) return;
  const target = document.getElementById(decodeURIComponent(link.hash.slice(1)));
  if (!target) return;

  event.preventDefault();
  stopWheelAnimation();
  const targetLeft =
    target.getBoundingClientRect().left -
    pageShell.getBoundingClientRect().left +
    pageShell.scrollLeft;
  const maximum = pageShell.scrollWidth - pageShell.clientWidth;
  pageShell.scrollTo({
    left: Math.max(0, Math.min(maximum, targetLeft)),
    behavior: scrollBehavior(),
  });
  target.focus({ preventScroll: true });
}

async function initialize() {
  applyTheme(currentTheme());
  themeToggle?.addEventListener("click", toggleTheme);

  const [, parts] = await Promise.all([
    document.fonts?.ready || Promise.resolve(),
    loadPillarParts(assetBase, moduleVersion),
  ]);
  pillarParts = parts;
  buildSectionLabels();
  layout();
  window.addEventListener("resize", scheduleLayout, { passive: true });
  desktopQuery.addEventListener?.("change", scheduleLayout);
  pageShell.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("keydown", handleKeyboard);
  pageShell.addEventListener("wheel", handleWheel, { passive: false });
  pageShell.addEventListener("click", handleAnchorClick);
  sectionLabels?.addEventListener("click", handleSectionClick);
  progressScrubber?.addEventListener("click", handleScrubberClick);
}

initialize().catch((error) => {
  console.error("The horizontal reading layout could not be initialized.", error);
});
