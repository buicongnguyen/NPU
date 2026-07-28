import { readFile, readdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const htmlFiles = (await readdir(process.cwd()))
  .filter((name) => name.endsWith(".html"))
  .sort();
const canonicalFiles = htmlFiles.filter((name) => name !== "npu.html");

async function waitForBookShell(page) {
  await page.waitForFunction(
    () => document.documentElement.dataset.bookShellReady === "true"
  );
}

test("the legacy NPU overview stays content-equivalent to the canonical homepage", async () => {
  const [canonical, alias] = await Promise.all([
    readFile("index.html", "utf8"),
    readFile("npu.html", "utf8")
  ]);
  const normalizeLineEndings = (content) => content.replace(/\r\n/g, "\n").trimEnd();
  expect(normalizeLineEndings(alias)).toBe(normalizeLineEndings(canonical));
});

test("the reader and its relative assets work from the GitHub Pages project path", async ({
  page
}) => {
  const browserErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  const rootResponse = await page.goto("/NPU/", { waitUntil: "networkidle" });
  expect(rootResponse?.ok()).toBeTruthy();
  await waitForBookShell(page);
  await expect(page.locator('.book-chapter-link[aria-current="page"]')).toHaveAttribute(
    "href",
    "index.html"
  );

  const response = await page.goto("/NPU/analog-cim-architecture.html", {
    waitUntil: "networkidle"
  });
  expect(response?.ok()).toBeTruthy();
  await waitForBookShell(page);
  await expect(page.locator("#stage-list button")).toHaveCount(8);
  await expect(page.locator('.book-chapter-link[aria-current="page"]')).toHaveCount(1);

  const rootAbsoluteReferences = await page
    .locator("a[href], link[href], script[src]")
    .evaluateAll((elements) =>
      elements
        .map((element) => element.getAttribute("href") || element.getAttribute("src"))
        .filter((value) => value?.startsWith("/") && !value.startsWith("//"))
    );
  expect(rootAbsoluteReferences).toEqual([]);

  await page.locator(".book-pager-next").click();
  await expect(page).toHaveURL(/\/NPU\/analog-cim-evidence\.html$/);
  await waitForBookShell(page);
  expect(browserErrors).toEqual([]);
});

test("the book chapter manifest covers every page and marks one current chapter", async ({
  page
}) => {
  test.setTimeout(90_000);

  for (const file of htmlFiles) {
    await page.goto(`/${file}`, { waitUntil: "networkidle" });
    await waitForBookShell(page);

    await expect(page.locator(".book-topbar")).toHaveCount(1);
    await expect(page.locator(".book-sidebar")).toHaveCount(1);
    await expect(page.locator(".book-chapter-link")).toHaveCount(canonicalFiles.length);
    await expect(page.locator('.book-chapter-link[aria-current="page"]')).toHaveCount(1);
    await expect(page.locator(".book-theme-toggle")).toHaveCount(1);

    const chapterTargets = (
      await page.locator(".book-chapter-link").evaluateAll((links) =>
        links.map((link) => new URL(link.href).pathname.split("/").pop()).sort()
      )
    );
    expect(chapterTargets, `${file} should render the canonical chapter set`).toEqual(
      [...canonicalFiles].sort()
    );
  }

  await page.goto("/npu.html");
  await waitForBookShell(page);
  await expect(page.locator('.book-chapter-link[aria-current="page"]')).toHaveAttribute(
    "href",
    "index.html"
  );
});

test("desktop chapter navigation is fixed, collapsible, and restores the reading column", async ({
  page
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/npu-architecture-performance-study.html");
  await waitForBookShell(page);

  const sidebar = page.locator(".book-sidebar");
  const menu = page.getByRole("button", { name: "Toggle study chapters" });
  const initialLayout = await page.evaluate(() => ({
    padding: Number.parseFloat(getComputedStyle(document.body).paddingLeft),
    position: getComputedStyle(document.querySelector(".book-sidebar")).position,
    sidebarWidth: document.querySelector(".book-sidebar").getBoundingClientRect().width
  }));
  expect(initialLayout.padding).toBeGreaterThan(260);
  expect(initialLayout.position).toBe("fixed");
  expect(initialLayout.sidebarWidth).toBeGreaterThan(270);
  await expect(menu).toHaveAttribute("aria-expanded", "true");

  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("body")).toHaveClass(/book-sidebar-collapsed/);
  await expect
    .poll(() =>
      page.evaluate(() => Number.parseFloat(getComputedStyle(document.body).paddingLeft))
    )
    .toBe(0);

  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar).not.toHaveAttribute("aria-hidden", "true");

  await page.setViewportSize({ width: 1000, height: 720 });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");
  const intermediateLayout = await page.evaluate(() => ({
    padding: Number.parseFloat(getComputedStyle(document.body).paddingLeft),
    mainWidth: document.querySelector("main").getBoundingClientRect().width
  }));
  expect(intermediateLayout.padding).toBe(0);
  expect(intermediateLayout.mainWidth).toBeGreaterThan(940);
});

test("mobile chapter drawer traps focus, closes with Escape and backdrop, and restores focus", async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/npu-framework-compiler-skills.html");
  await waitForBookShell(page);

  const body = page.locator("body");
  const sidebar = page.locator(".book-sidebar");
  const menu = page.getByRole("button", { name: "Toggle study chapters" });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");
  await expect(sidebar).toHaveAttribute("inert", "");

  await menu.click();
  await expect(body).toHaveClass(/book-drawer-open/);
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar).toHaveAttribute("aria-modal", "true");
  await expect(sidebar).not.toHaveAttribute("inert", "");
  await expect(page.locator(".book-topbar")).toHaveAttribute("inert", "");
  await expect(page.locator("main")).toHaveAttribute("inert", "");
  await expect
    .poll(() => page.evaluate(() => document.querySelector(".book-sidebar").contains(document.activeElement)))
    .toBe(true);

  const drawerClose = sidebar.getByRole("button", { name: "Close study chapters" });
  const lastDrawerLink = sidebar.getByRole("link", {
    name: "Source and contributions"
  });
  await expect(drawerClose).toBeVisible();
  await drawerClose.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(lastDrawerLink).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(body).not.toHaveClass(/book-drawer-open/);
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeFocused();
  await expect(page.locator(".book-topbar")).not.toHaveAttribute("inert", "");
  await expect(page.locator("main")).not.toHaveAttribute("inert", "");

  await menu.click();
  await expect(body).toHaveClass(/book-drawer-open/);
  await page.mouse.click(370, 120);
  await expect(body).not.toHaveClass(/book-drawer-open/);
  await expect(menu).toBeFocused();
});

test("theme follows the system until selected, then persists across page families", async ({
  page
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/index.html");
  await page.evaluate(() => {
    localStorage.removeItem("site-color-theme");
    localStorage.removeItem("npu-theme");
  });
  await page.reload();
  await waitForBookShell(page);

  const toggle = page.locator(".book-theme-toggle");
  await expect(page.locator("html")).toHaveAttribute("data-book-theme", "light");
  await expect(toggle).toHaveAttribute("aria-label", "Switch to dark theme");
  await expect(toggle).not.toHaveAttribute("aria-pressed", /.+/);

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-book-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-book-theme", "light");

  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-book-theme", "dark");
  await expect(toggle).toHaveAttribute("aria-label", "Switch to light theme");
  await expect(toggle).not.toHaveAttribute("aria-pressed", /.+/);

  await page.goto("/npu-practice.html");
  await waitForBookShell(page);
  await expect(page.locator("html")).toHaveAttribute("data-book-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.locator(".book-theme-toggle").click();
  await page.goto("/c-practice.html");
  await waitForBookShell(page);
  await expect(page.locator("html")).toHaveAttribute("data-book-theme", "light");
  await expect(page.locator("body")).toHaveCSS("color", "rgb(24, 38, 58)");
});

test("the in-page outline tracks scrolling without rewriting the URL", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/npu-architecture-performance-study.html");
  await waitForBookShell(page);

  const outline = page.locator(".book-page-outline");
  await expect(outline).toHaveCount(1);
  await expect(page.locator(".book-page-outline-link")).toHaveCount(14);
  await expect(
    page.getByRole("heading", {
      name: "Use the same operator loop: semantics → work → traffic → mapping → proof",
      exact: true
    })
  ).toHaveCount(1);
  await outline.locator("summary").click();

  const originalUrl = page.url();
  await page.locator("#operators").evaluate((target) => {
    const top = target.getBoundingClientRect().top + window.scrollY - 88;
    window.scrollTo({ top, behavior: "instant" });
  });
  await expect(
    page.locator('.book-page-outline-link[href="#operators"]')
  ).toHaveAttribute("aria-current", "location");
  expect(page.url()).toBe(originalUrl);

  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
  await expect(page.locator(".book-page-outline-link").last()).toHaveAttribute(
    "aria-current",
    "location"
  );
  expect(page.url()).toBe(originalUrl);
});

test("the existing NPU practice TOC remains available without JavaScript", async ({
  browser,
  baseURL
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${baseURL}/npu-practice.html`, { waitUntil: "domcontentloaded" });

  await expect(page.locator("nav.toc")).toBeVisible();
  await expect(page.locator(".book-topbar")).toHaveCount(0);
  await expect(page.locator("main")).toBeVisible();

  await context.close();
});

test("print mode removes reader chrome and sidebar spacing", async ({ page }) => {
  await page.goto("/npu-practice.html");
  await page.evaluate(() => localStorage.setItem("site-color-theme", "dark"));
  await page.reload();
  await waitForBookShell(page);
  const closedCardIndex = await page
    .locator("details.qa")
    .evaluateAll((cards) => cards.findIndex((card) => !card.open));
  expect(closedCardIndex).toBeGreaterThanOrEqual(0);
  const npuAnswer = page.locator("details.qa").nth(closedCardIndex).locator(".ans");
  await expect(npuAnswer).toBeHidden();
  await page.emulateMedia({ media: "print" });

  await expect(page.locator(".book-topbar")).toBeHidden();
  await expect(page.locator(".book-sidebar")).toBeHidden();
  await expect(page.locator("nav.toc")).toBeHidden();
  await expect(npuAnswer).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("color", "rgb(17, 17, 17)");
  const printTokens = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return {
      accentStrong: styles.getPropertyValue("--accent-strong").trim(),
      tealStrong: styles.getPropertyValue("--teal-strong").trim(),
      greenInk: styles.getPropertyValue("--green-ink").trim(),
      amberInk: styles.getPropertyValue("--amber-ink").trim(),
      redInk: styles.getPropertyValue("--red-ink").trim()
    };
  });
  expect(printTokens).toEqual({
    accentStrong: "#063d70",
    tealStrong: "#004b45",
    greenInk: "#155b2b",
    amberInk: "#5d4100",
    redInk: "#812a32"
  });
  await expect
    .poll(() =>
      page.evaluate(() => Number.parseFloat(getComputedStyle(document.body).paddingLeft))
    )
    .toBe(0);

  await page.goto("/c-practice.html");
  await waitForBookShell(page);
  await expect(page.locator("details.qa .answer").first()).toBeVisible();
});
