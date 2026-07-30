import { readFile, readdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";

const htmlFiles = (await readdir(process.cwd()))
  .filter((name) => name.endsWith(".html"))
  .sort();
const canonicalFiles = htmlFiles.filter((name) => name !== "npu.html");
const bookManifest = JSON.parse(await readFile("data/book-manifest.json", "utf8"));
const bookSearchIndexSource = await readFile("data/book-search-index.json", "utf8");
const bookSearchIndex = JSON.parse(bookSearchIndexSource);
const expectedChapterOrder = bookManifest.groups.flatMap((group) =>
  group.pages.map((page) => page.path)
);
const expectedGroupTitles = bookManifest.groups.map((group) => group.title);
const searchAnchorsByPath = new Map();
for (const entry of bookSearchIndex.entries) {
  if (!entry.anchor) continue;
  const entries = searchAnchorsByPath.get(entry.path) || [];
  entries.push(entry);
  searchAnchorsByPath.set(entry.path, entries);
}

test("the generated index includes each dynamically rendered practice bank", () => {
  const expectedQuestions = new Map([
    [
      "c-practice.html",
      {
        question: "What is undefined behavior in C?",
        anchor: "practice-question-1-1"
      }
    ],
    [
      "deep-learning-practice.html",
      {
        question: "What is a trainable parameter?",
        anchor: "practice-question-1-1"
      }
    ],
    [
      "embedded-practice.html",
      {
        question: "What does volatile tell the compiler?",
        anchor: "practice-question-1-1"
      }
    ],
    [
      "git-practice.html",
      {
        question: "What does `git init` do?",
        anchor: "practice-question-1-1"
      }
    ],
    [
      "os-practice.html",
      {
        question: "What does fork() create?",
        anchor: "practice-question-1-1"
      }
    ],
    [
      "interview-practice.html",
      {
        question: "Why do neural networks need nonlinear activation functions?",
        anchor: "interview-question-1-1-2"
      }
    ]
  ]);

  for (const [path, { question, anchor }] of expectedQuestions) {
    const match = bookSearchIndex.entries.find(
      (entry) => entry.path === path && entry.heading === question
    );
    expect(match, `${path} should contribute its rendered question bank`).toBeTruthy();
    expect(match.anchor).toBe(anchor);
    expect(match.text.trim()).not.toBe("");
  }
});

test("the lazy search index stays within its transfer budget", () => {
  expect(Buffer.byteLength(bookSearchIndexSource)).toBeLessThanOrEqual(2_000_000);
  expect(gzipSync(bookSearchIndexSource).byteLength).toBeLessThanOrEqual(450_000);
});

async function waitForBookShell(page) {
  await page.waitForFunction(
    () => document.documentElement.dataset.bookShellReady === "true"
  );
}

test.beforeEach(async ({ context }) => {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const isLocalHttp =
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost");
    if ((url.protocol === "http:" || url.protocol === "https:") && !isLocalHttp) {
      if (route.request().resourceType() === "image") {
        await route.fulfill({
          status: 200,
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
        });
        return;
      }
      await route.abort();
      return;
    }
    await route.continue();
  });
});

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
    await expect(page.locator("html")).not.toHaveClass(/book-shell-booting/);
    await expect(page.locator("body > header.site-header")).toBeHidden();
    await expect(page.locator("h1")).toBeVisible();

    const chapterTargets = (
      await page.locator(".book-chapter-link").evaluateAll((links) =>
        links.map((link) => new URL(link.href).pathname.split("/").pop())
      )
    );
    expect(chapterTargets, `${file} should render the pedagogical chapter order`).toEqual(
      expectedChapterOrder
    );
    expect([...chapterTargets].sort()).toEqual([...canonicalFiles].sort());
    const canonicalPath = file === "npu.html" ? "index.html" : file;
    const expectedAnchors = (searchAnchorsByPath.get(canonicalPath) || []).map(
      (entry) => entry.anchor
    );
    const missingAnchors = await page.evaluate(
      (anchors) => anchors.filter((id) => !document.getElementById(id)),
      expectedAnchors
    );
    expect(
      missingAnchors,
      `${file} should expose every generated search deep link`
    ).toEqual([]);
  }

  await page.goto("/npu.html");
  await waitForBookShell(page);
  await expect(page.locator('.book-chapter-link[aria-current="page"]')).toHaveAttribute(
    "href",
    "index.html"
  );
});

test("chapter tracks put foundations before dependent role studies", async ({ page }) => {
  await page.goto("/npu-framework-compiler-skills.html");
  await waitForBookShell(page);

  await expect(page.locator(".book-nav-group-title")).toHaveText(expectedGroupTitles);
  const compilerChapter = expectedChapterOrder.indexOf(
    "npu-framework-compiler-skills.html"
  ) + 1;
  await expect(page.locator(".book-chapter-index")).toHaveText(
    `Chapter ${compilerChapter} / ${expectedChapterOrder.length}`
  );
  await expect(page.locator(".book-chapter-position")).toHaveAttribute(
    "aria-label",
    `Chapter ${compilerChapter} of ${expectedChapterOrder.length}`
  );
  await expect(page.locator(".book-chapter-position progress")).toHaveCount(0);
});

test("pager boundaries keep the main path separate from the optional specialization", async ({
  page
}) => {
  const expectPager = async (path, previous, next) => {
    await page.goto(path);
    await waitForBookShell(page);

    if (previous) {
      await expect(page.locator(".book-pager-previous")).toHaveAttribute(
        "href",
        previous
      );
    } else {
      await expect(page.locator(".book-pager-previous")).toHaveCount(0);
    }
    if (next) {
      await expect(page.locator(".book-pager-next")).toHaveAttribute("href", next);
    } else {
      await expect(page.locator(".book-pager-next")).toHaveCount(0);
    }
  };

  await expectPager(
    "/embedded-practice.html",
    "os-practice.html",
    "npu-architecture-performance-study.html"
  );
  await expectPager(
    "/accelerator-repository-blueprint.html",
    "npu-soc-software-architecture.html",
    "npu-practice.html"
  );
  await expectPager(
    "/interview-practice.html",
    "npu-practice.html",
    null
  );
  await expectPager(
    "/analog-cim-architecture.html",
    "interview-practice.html",
    "analog-cim-evidence.html"
  );
  await expectPager(
    "/analog-cim-quiz.html",
    "analog-cim-interview.html",
    null
  );
});

test("the shell replaces the legacy header but preserves its no-JavaScript fallback", async ({
  browser,
  baseURL,
  page
}) => {
  await page.goto("/npu-framework-compiler-skills.html");
  await waitForBookShell(page);
  await expect(page.locator("body > header.site-header")).toHaveCount(1);
  await expect(page.locator("body > header.site-header")).toBeHidden();

  const context = await browser.newContext({ javaScriptEnabled: false });
  const noScriptPage = await context.newPage();
  await noScriptPage.goto(`${baseURL}/npu-framework-compiler-skills.html`, {
    waitUntil: "domcontentloaded"
  });
  await expect(noScriptPage.locator("body > header.site-header")).toHaveCount(1);
  await expect(noScriptPage.locator("body > header.site-header")).toBeVisible();
  await context.close();

  await page.goto("/deep-learning-practice.html");
  await waitForBookShell(page);
  await expect(page.locator("body > header")).toBeVisible();
  await expect(page.locator("body > header h1")).toBeVisible();
});

test("shell failures restore the original readable page", async ({ browser, baseURL }) => {
  const earlyContext = await browser.newContext();
  await earlyContext.addInitScript(() => {
    const originalMatchMedia = window.matchMedia.bind(window);
    let shouldFail = true;
    window.matchMedia = (query) => {
      if (shouldFail) {
        shouldFail = false;
        window.matchMedia = originalMatchMedia;
        throw new Error("Injected early shell failure");
      }
      return originalMatchMedia(query);
    };
  });
  const earlyPage = await earlyContext.newPage();
  await earlyPage.goto(`${baseURL}/npu-framework-compiler-skills.html`, {
    waitUntil: "domcontentloaded"
  });
  await expect(earlyPage.locator("html")).not.toHaveClass(/book-shell-booting/);
  await expect(earlyPage.locator("html")).toHaveAttribute(
    "data-book-shell-ready",
    "error"
  );
  await expect(earlyPage.locator("body > header.site-header")).toBeVisible();
  await expect(earlyPage.locator("h1")).toBeVisible();
  await expect(earlyPage.locator("[data-book-shell-owned]")).toHaveCount(0);
  await earlyContext.close();

  const manifestContext = await browser.newContext();
  await manifestContext.route("**/data/book-manifest.json", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: "{}"
    })
  );
  const manifestPage = await manifestContext.newPage();
  await manifestPage.goto(`${baseURL}/npu-framework-compiler-skills.html`, {
    waitUntil: "domcontentloaded"
  });
  await expect(manifestPage.locator("html")).toHaveAttribute(
    "data-book-shell-ready",
    "error"
  );
  await expect(manifestPage.locator("html")).not.toHaveClass(/book-shell-booting/);
  await expect(manifestPage.locator("body > header.site-header")).toBeVisible();
  await expect(manifestPage.locator("h1")).toBeVisible();
  await expect(manifestPage.locator("[data-book-shell-owned]")).toHaveCount(0);
  await manifestContext.close();

  const lateContext = await browser.newContext();
  await lateContext.addInitScript(() => {
    const originalAnimationFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      if (document.body?.classList.contains("book-shell-active")) {
        throw new Error("Injected late shell failure");
      }
      return originalAnimationFrame(callback);
    };
  });
  const latePage = await lateContext.newPage();
  await latePage.goto(`${baseURL}/npu-practice.html`, {
    waitUntil: "domcontentloaded"
  });
  await expect(latePage.locator("html")).not.toHaveClass(/book-shell-booting/);
  await expect(latePage.locator("html")).toHaveAttribute(
    "data-book-shell-ready",
    "error"
  );
  await expect(latePage.locator("body")).not.toHaveClass(/book-shell-active/);
  await expect(latePage.locator("nav.toc")).not.toHaveAttribute(
    "aria-hidden",
    "true"
  );
  await expect(latePage.locator("nav.toc")).toBeVisible();
  await expect(latePage.locator("h1")).toBeVisible();
  await expect(latePage.locator("[data-book-shell-owned]")).toHaveCount(0);
  await lateContext.close();
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
  await expect(page.locator(".book-page-outline")).not.toHaveAttribute("open", "");

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

test("outline default follows the desktop shell breakpoint and opens for deep links", async ({
  page
}) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto("/npu-architecture-performance-study.html");
  await waitForBookShell(page);
  await expect(page.locator(".book-page-outline")).not.toHaveAttribute("open", "");

  await page.goto("/npu-architecture-performance-study.html#operators");
  await waitForBookShell(page);
  await expect(page.locator(".book-page-outline")).toHaveAttribute("open", "");
});

test("sidebar focus is restored when responsive and page-retaining links hide the drawer", async ({
  context,
  page
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/npu-framework-compiler-skills.html");
  await waitForBookShell(page);

  const menu = page.getByRole("button", { name: "Toggle study chapters" });
  const currentChapter = page.locator('.book-chapter-link[aria-current="page"]');
  await currentChapter.focus();
  await expect(currentChapter).toBeFocused();

  await page.setViewportSize({ width: 1000, height: 720 });
  await expect(page.locator(".book-sidebar")).toHaveAttribute("inert", "");
  await expect(menu).toBeFocused();

  await menu.click();
  await expect(currentChapter).toBeFocused();
  const [popup] = await Promise.all([
    context.waitForEvent("page"),
    currentChapter.click({ modifiers: ["Control"] })
  ]);
  await popup.close();

  await expect(page.locator("body")).not.toHaveClass(/book-drawer-open/);
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
  await expect
    .poll(() => page.locator("html").evaluate((element) => element.style.colorScheme))
    .toBe("");
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

test("whole-book search opens from the keyboard and deep-links to canonical topics", async ({
  page
}) => {
  await page.goto("/npu-framework-compiler-skills.html");
  await waitForBookShell(page);

  const searchButton = page.getByRole("button", {
    name: "Search the study guide"
  });
  await searchButton.click();
  const dialog = page.getByRole("dialog", { name: "Search the study guide" });
  await expect(dialog).toBeVisible();
  const input = page.getByRole("searchbox", { name: "Search topics" });
  await expect(input).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(searchButton).toBeFocused();

  await page.keyboard.press("Control+k");
  await expect(dialog).toBeVisible();
  await input.fill("ISA and command definition checklist");
  await expect(dialog.getByRole("status")).toContainText(/result/);
  const result = dialog
    .getByRole("link")
    .filter({ hasText: "ISA and command definition checklist" })
    .first();
  await expect(result).toHaveAttribute(
    "href",
    /npu-architecture-performance-study\.html#book-isa-and-command-definition-checklist/
  );
  const resultHrefs = await dialog
    .locator(".book-search-result-link")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(resultHrefs.every((href) => !href.startsWith("npu.html"))).toBeTruthy();

  await input.fill("fabless semiconductor");
  await expect(dialog.getByRole("status")).toContainText(/result/);
  const fablessHrefs = await dialog
    .locator(".book-search-result-link")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(fablessHrefs[0]).toMatch(
    /^npu-architecture-performance-study\.html(?:#|$)/
  );
  expect(fablessHrefs.length).toBeLessThanOrEqual(5);
  expect(
    fablessHrefs.some((href) =>
      href.startsWith("analog-cim-mythic-videantis.html#")
    )
  ).toBeFalsy();

  await input.fill("ISA and command definition checklist");
  await result.click();
  await expect(page).toHaveURL(
    /npu-architecture-performance-study\.html#book-isa-and-command-definition-checklist/
  );
  await waitForBookShell(page);
  await expect(
    page.locator("#book-isa-and-command-definition-checklist")
  ).toBeVisible();
});

test("whole-book search finds dynamically rendered practice questions", async ({
  page
}) => {
  await page.goto("/npu-framework-compiler-skills.html");
  await waitForBookShell(page);
  await page.keyboard.press("Control+k");

  const dialog = page.getByRole("dialog", { name: "Search the study guide" });
  await dialog
    .getByRole("searchbox", { name: "Search topics" })
    .fill("What does volatile tell the compiler?");
  const result = dialog
    .getByRole("link")
    .filter({ hasText: "What does volatile tell the compiler?" })
    .first();
  await expect(result).toHaveAttribute(
    "href",
    "embedded-practice.html#practice-question-1-1"
  );
  await result.click();
  await waitForBookShell(page);
  const target = page.locator("#practice-question-1-1");
  await expect(target).toBeVisible();
  await expect(target).toHaveAttribute("open", "");
  await expect(target.locator(".answer")).toBeVisible();

  await page.goto(
    "/interview-practice.html#interview-question-1-1-2"
  );
  await waitForBookShell(page);
  const interviewTarget = page.locator("#interview-question-1-1-2");
  await expect(interviewTarget).toHaveAttribute("open", "");
  await expect(interviewTarget.locator(".answer")).toBeVisible();
});

test("same-page search moves focus and the viewport to the selected topic", async ({
  page
}) => {
  await page.goto("/npu-framework-compiler-skills.html");
  await waitForBookShell(page);
  await page.keyboard.press("Control+k");

  const dialog = page.getByRole("dialog", { name: "Search the study guide" });
  await dialog
    .getByRole("searchbox", { name: "Search topics" })
    .fill("ISA and ABI review checklist");
  await dialog
    .getByRole("link", { name: /ISA and ABI review checklist/ })
    .first()
    .click();

  const target = page.locator("#book-isa-and-abi-review-checklist");
  await expect(page).toHaveURL(/#book-isa-and-abi-review-checklist$/);
  await expect(dialog).toBeHidden();
  await expect(target).toBeFocused();
  await expect
    .poll(() =>
      target.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.top >= 0 && bounds.top < window.innerHeight;
      })
    )
    .toBeTruthy();
});

test("search deep links reveal headings inside inactive tab panels", async ({ page }) => {
  const hiddenTargets = [
    [
      "/npu-architecture-performance-study.html#book-gemm-performance-follows-the-entire-blocking-hierarchy",
      "operator-gemm"
    ],
    [
      "/npu-framework-compiler-skills.html#book-pytorch-compile-and-export-are-related-but-not-interchangeable",
      "framework-compile"
    ],
    [
      "/npu-soc-software-architecture.html#book-driver-to-firmware",
      "contract-firmware"
    ],
    [
      "/analog-cim-hardware-software-codesign.html#book-the-same-mvm-produces-a-distribution-not-an-exact-value",
      "failure-read"
    ],
    [
      "/analog-cim-tenstorrent-reuse.html#book-quantization-is-only-one-part-of-analog-numerical-behavior",
      "mismatch-number"
    ]
  ];

  for (const [url, panelId] of hiddenTargets) {
    await page.goto(url);
    await waitForBookShell(page);
    const targetId = new URL(page.url()).hash.slice(1);
    await expect(page.locator(`#${panelId}`)).not.toHaveAttribute("hidden", "");
    await expect(page.locator(`#${targetId}`)).toBeVisible();
  }
});

test("search rejects non-canonical index entries without breaking chapter navigation", async ({
  page
}) => {
  await page.route("**/data/book-search-index.json", async (route) => {
    const unsafeIndex = {
      schemaVersion: 1,
      chapterCount: expectedChapterOrder.length,
      entries: [
        {
          ...bookSearchIndex.entries[0],
          path: "javascript:alert(1)"
        }
      ]
    };
    await route.fulfill({ json: unsafeIndex });
  });
  await page.goto("/npu-framework-compiler-skills.html");
  await waitForBookShell(page);
  await page.getByRole("button", { name: "Search the study guide" }).click();
  const dialog = page.getByRole("dialog", { name: "Search the study guide" });
  await dialog.getByRole("searchbox", { name: "Search topics" }).fill("MLIR");
  await expect(dialog.getByRole("status")).toContainText(
    "Search is temporarily unavailable"
  );
  await expect(dialog.locator(".book-search-result-link")).toHaveCount(0);
  await expect(page.locator('.book-chapter-link[aria-current="page"]')).toHaveCount(
    1
  );
});

test("chapter bookmarks are manual, visible in the rail, and persist", async ({ page }) => {
  await page.goto("/npu-framework-compiler-skills.html");
  await page.evaluate(() =>
    localStorage.removeItem("npu-study-guide-bookmarks-v1")
  );
  await page.reload();
  await waitForBookShell(page);

  const bookmarkButton = page.locator(".book-bookmark-toggle");
  await expect(bookmarkButton).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".book-bookmarks-count")).toHaveText("0");
  await bookmarkButton.click();
  await expect(bookmarkButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".book-bookmarks-count")).toHaveText("1");
  await expect(
    page.locator(".book-bookmark-link", {
      hasText: "Frontend compiler, IR, and code generation"
    })
  ).toBeVisible();
  await expect(
    page.locator('.book-chapter-link[aria-current="page"]')
  ).toHaveClass(/book-chapter-bookmarked/);

  await page.goto("/npu-soc-software-architecture.html");
  await waitForBookShell(page);
  await expect(page.locator(".book-bookmarks-count")).toHaveText("1");
  await expect(
    page.locator(".book-bookmark-link", {
      hasText: "Frontend compiler, IR, and code generation"
    })
  ).toBeVisible();
  await expect(page.locator(".book-bookmark-toggle")).toHaveAttribute(
    "aria-pressed",
    "false"
  );

  await page.reload();
  await waitForBookShell(page);
  await expect(page.locator(".book-bookmarks-count")).toHaveText("1");
  await expect(page.locator(".book-chapter-position progress")).toHaveCount(0);
});

test("many bookmarks remain scrollable without hiding chapter navigation", async ({
  page
}) => {
  await page.addInitScript((paths) => {
    localStorage.setItem("npu-study-guide-bookmarks-v1", JSON.stringify(paths));
  }, expectedChapterOrder);

  for (const viewport of [
    { width: 1280, height: 600 },
    { width: 390, height: 600 }
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/npu-framework-compiler-skills.html");
    await waitForBookShell(page);
    if (viewport.width < 1181) {
      await page.getByRole("button", { name: "Toggle study chapters" }).click();
    }

    await expect(page.locator(".book-bookmarks-count")).toHaveText(
      String(expectedChapterOrder.length)
    );
    const layout = await page.evaluate(() => {
      const panel = document.querySelector(".book-bookmarks-panel");
      const list = document.querySelector(".book-bookmarks-list");
      const chapters = document.querySelector(".book-chapter-nav");
      const footer = document.querySelector(".book-sidebar-footer");
      return {
        panelHeight: panel.getBoundingClientRect().height,
        listClientHeight: list.clientHeight,
        listScrollHeight: list.scrollHeight,
        chapterHeight: chapters.getBoundingClientRect().height,
        footerVisible: footer.getBoundingClientRect().bottom <= window.innerHeight
      };
    });
    expect(layout.panelHeight).toBeLessThanOrEqual(242);
    expect(layout.listScrollHeight).toBeGreaterThan(layout.listClientHeight);
    expect(layout.chapterHeight).toBeGreaterThan(60);
    expect(layout.footerVisible).toBeTruthy();
  }
});

test("the in-page outline tracks scrolling without rewriting the URL", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/npu-architecture-performance-study.html");
  await waitForBookShell(page);

  const outline = page.locator(".book-page-outline");
  await expect(outline).toHaveCount(1);
  await expect(outline).toHaveAttribute("open", "");
  expect(await page.locator(".book-page-outline-link").count()).toBeGreaterThan(14);
  expect(await page.locator(".book-page-outline-level-3").count()).toBeGreaterThan(0);
  await expect(page.locator(".book-page-outline-sublist").first()).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Use the same operator loop: semantics → work → traffic → mapping → proof",
      exact: true
    })
  ).toHaveCount(1);
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

test("reading progress ignores its own style mutations and tracks dynamic document height", async ({
  page
}) => {
  await page.addInitScript(() => {
    const querySelectorAll = Element.prototype.querySelectorAll;
    window.__bodyWideScrollabilityScans = 0;
    Element.prototype.querySelectorAll = function (selector) {
      if (this === document.body && selector === "*") {
        window.__bodyWideScrollabilityScans += 1;
      }
      return querySelectorAll.apply(this, arguments);
    };
  });

  await page.goto("/c-practice.html", { waitUntil: "networkidle" });
  await waitForBookShell(page);
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      })
  );
  await page.evaluate(() => {
    window.__bodyWideScrollabilityScans = 0;
  });

  const scanCount = await page.evaluate(async () => {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    for (let step = 1; step <= 30; step += 1) {
      window.scrollTo({ top: (maxScroll * step) / 30, behavior: "instant" });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return window.__bodyWideScrollabilityScans;
  });
  expect(scanCount).toBeLessThanOrEqual(2);

  await page.goto("/npu-practice.html", { waitUntil: "networkidle" });
  await waitForBookShell(page);
  await page.evaluate(() => window.scrollTo({ top: 3000, behavior: "instant" }));
  await page.locator("#q").evaluate((input) => {
    input.value = "no-result-layout-regression-token";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect
    .poll(() => page.locator("details.qa.nohit, .termdef.nohit").count())
    .toBeGreaterThan(100);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const maxScroll = Math.max(
          0,
          document.documentElement.scrollHeight - window.innerHeight
        );
        const expected =
          maxScroll === 0 ? 100 : Math.round((window.scrollY / maxScroll) * 100);
        const actual = Number(
          document.querySelector(".book-reading-progress").getAttribute("aria-valuenow")
        );
        return actual - expected;
      })
    )
    .toBe(0);
});

test("back-to-top honors the reduced-motion preference", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/npu-practice.html");
  await waitForBookShell(page);
  await page.evaluate(() => {
    window.scrollTo({ top: 5000, behavior: "instant" });
    const nativeScrollTo = window.scrollTo.bind(window);
    window.__lastScrollBehavior = "";
    window.scrollTo = function () {
      const firstArgument = arguments[0];
      if (firstArgument && typeof firstArgument === "object") {
        window.__lastScrollBehavior = firstArgument.behavior;
      }
      return nativeScrollTo(...arguments);
    };
  });

  await page.getByRole("button", { name: "Back to top" }).click();
  expect(await page.evaluate(() => window.__lastScrollBehavior)).toBe("auto");
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("NPU practice choices expose selected and correct results as text", async ({ page }) => {
  await page.goto("/npu-practice.html");
  await waitForBookShell(page);

  const card = page.locator("details.qa.mcq").first();
  await card.locator("summary").click();
  await card.locator(".choices li").nth(1).click();

  await expect(card.locator(".choices li.chosen .mcq-result-label")).toHaveText(
    "Your answer — incorrect"
  );
  await expect(card.locator(".choices li.correct .mcq-result-label")).toHaveText(
    "Correct answer"
  );
  await expect(card.locator(".mcq-result-label")).toHaveCount(2);
  await expect(card.locator(".choices li[aria-disabled='true']")).toHaveCount(4);
  expect(
    await card.locator(".choices li").evaluateAll((choices) =>
      choices.map((choice) => choice.tabIndex)
    )
  ).toEqual([-1, -1, -1, -1]);
  await expect(card.locator(".mcq-result-status")).toContainText(
    "Incorrect. Correct answer:"
  );
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
  const closedAnswer = page.locator("details.qa:not([open]) .ans").first();
  const closedExplanation = page.locator("details.qa:not([open]) .ans .why").first();
  await expect(closedAnswer).toBeHidden();
  await expect(closedExplanation).toBeHidden();

  await page.emulateMedia({ media: "print" });
  await expect(closedAnswer).toBeVisible();
  await expect(closedExplanation).toBeVisible();

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
