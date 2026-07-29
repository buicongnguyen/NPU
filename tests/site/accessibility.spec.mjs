import { readdir } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const pages = (await readdir(process.cwd()))
  .filter((name) => name.endsWith('.html'))
  .sort()
  .map((name) => `/${name}`);
const viewports = [
  ['desktop', { width: 1280, height: 720 }],
  ['mobile', { width: 320, height: 720 }]
];

for (const path of pages) {
  for (const [viewportName, viewport] of viewports) {
    test(`axe WCAG A/AA (${viewportName}): ${path}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(path, { waitUntil: 'networkidle' });
      await page.waitForFunction(
        () => document.documentElement.dataset.scrollAccessibilityReady === 'true'
      );
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
          })
      );
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const summary = results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        description: violation.description,
        targets: violation.nodes.map((node) => node.target.join(' '))
      }));
      expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
    });
  }
}

test("book shell dark theme and open mobile drawer meet WCAG A/AA", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/npu-framework-compiler-skills.html");
  await page.evaluate(() => localStorage.setItem("site-color-theme", "dark"));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(
    () => document.documentElement.dataset.bookShellReady === "true"
  );
  await page.getByRole("button", { name: "Toggle study chapters" }).click();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const summary = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    description: violation.description,
    targets: violation.nodes.map((node) => node.target.join(" "))
  }));
  expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
});

test("book content controls meet WCAG A/AA in the closed dark theme", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(pages[0]);
  await page.evaluate(() => localStorage.setItem("site-color-theme", "dark"));

  for (const path of pages) {
    await page.goto(path, { waitUntil: "networkidle" });
    await page.waitForFunction(
      () => document.documentElement.dataset.bookShellReady === "true"
    );
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const summary = results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      description: violation.description,
      targets: violation.nodes.map((node) => node.target.join(" "))
    }));
    expect(summary, `${path}\n${JSON.stringify(summary, null, 2)}`).toEqual([]);
  }
});

test("dark-theme practice chapters retain print color contrast", async ({ page }) => {
  test.setTimeout(90_000);
  const paths = [
    "/c-practice.html",
    "/deep-learning-practice.html",
    "/embedded-practice.html",
    "/git-practice.html",
    "/interview-practice.html",
    "/os-practice.html"
  ];

  await page.goto(paths[0]);
  await page.evaluate(() => localStorage.setItem("site-color-theme", "dark"));
  await page.emulateMedia({ media: "print" });

  for (const path of paths) {
    await page.goto(path, { waitUntil: "networkidle" });
    await page.waitForFunction(
      () => document.documentElement.dataset.bookShellReady === "true"
    );
    await expect(page.locator("html")).toHaveAttribute("data-book-theme", "dark");
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)
    ).toBe("light");

    const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
    const summary = results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      description: violation.description,
      targets: violation.nodes.map((node) => node.target.join(" "))
    }));
    expect(summary, `${path}\n${JSON.stringify(summary, null, 2)}`).toEqual([]);
  }
});
