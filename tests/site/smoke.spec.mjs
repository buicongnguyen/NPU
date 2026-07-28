import { readdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const allPages = (await readdir(process.cwd()))
  .filter((name) => name.endsWith('.html'))
  .sort()
  .map((name) => `/${name}`);

for (const path of allPages) {
  test(`navigation smoke: ${path}`, async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    const response = await page.goto(path, { waitUntil: 'networkidle' });
    expect(response?.ok(), `${path} should return HTTP success`).toBeTruthy();
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page).toHaveTitle(/\S+/);
    expect(consoleErrors).toEqual([]);
  });
}

test('JSON-backed architecture and evidence content loads', async ({ page }) => {
  await page.goto('/analog-cim-architecture.html');
  await expect(page.locator('#stage-list button')).toHaveCount(8);
  await expect(page.locator('#technology-comparison-body tr')).toHaveCount(5);

  await page.goto('/analog-cim-evidence.html');
  await expect(page.locator('#evidence-body tr')).toHaveCount(14);
  await expect(page.locator('#issues-body tr')).toHaveCount(11);
  await expect(page.locator('#claim-tests .claim-item')).toHaveCount(10);
});

test('practice filtering narrows rendered questions', async ({ page }) => {
  await page.goto('/c-practice.html');
  const cards = page.locator('[data-search]');
  const total = await cards.count();
  expect(total).toBeGreaterThan(20);

  await page.getByLabel('Search C questions').fill('volatile');
  await expect(page.locator('#stats')).toContainText('matching');
  const visible = await page.locator('[data-search]:visible').count();
  expect(visible).toBeGreaterThan(0);
  expect(visible).toBeLessThan(total);
});

test('quiz can be filtered, answered, and advanced', async ({ page }) => {
  await page.goto('/analog-cim-quiz.html');
  await expect(page.locator('#quiz-body [role="radio"]')).toHaveCount(4);

  await page.getByLabel('Topic').selectOption({ label: 'Foundations' });
  await expect(page.locator('#progress-label')).toContainText('/ 5');
  await page.locator('#quiz-body [role="radio"]').first().click();
  await page.getByRole('button', { name: 'Check answer' }).click();

  await expect(page.locator('#quiz-feedback')).toBeVisible();
  await expect(page.locator('#quiz-feedback')).toContainText(/Correct\.|Not quite\./);
  await expect(page.getByRole('button', { name: 'Next question' })).toBeEnabled();
});

test('all pages contain horizontal scrolling within mobile-width regions', async ({ page }) => {
  test.setTimeout(90_000);

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of allPages) {
      await page.goto(path, { waitUntil: 'networkidle' });
      const sizes = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth
      }));
      expect(
        sizes.scrollWidth,
        `${path} should not overflow a ${width}px document viewport`
      ).toBeLessThanOrEqual(sizes.clientWidth);

      if (width === 320) {
        const scrollRegionLabels = await page
          .locator('[data-scroll-tabindex-managed]')
          .evaluateAll((regions) =>
            regions.map((region) => {
              const labelledBy = (region.getAttribute('aria-labelledby') || '')
                .split(/\s+/)
                .filter(Boolean)
                .map((id) => document.getElementById(id)?.textContent?.trim() || '')
                .filter(Boolean)
                .join(' ');
              return region.getAttribute('aria-label') || labelledBy || region.title;
            })
          );
        expect(
          scrollRegionLabels.every(Boolean),
          `${path} mobile scroll regions should have accessible names`
        ).toBeTruthy();
        const duplicateLabels = scrollRegionLabels.filter(
          (label, index) => scrollRegionLabels.indexOf(label) !== index
        );
        expect(
          [...new Set(duplicateLabels)],
          `${path} mobile scroll-region names should be distinguishable`
        ).toEqual([]);
      }
    }
  }
});

test('overflow regions enter the keyboard order only while scrollable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/npu.html', { waitUntil: 'networkidle' });

  const comparison = page.locator('.compare-wrap');
  await expect(comparison).toHaveAttribute('tabindex', '0');
  await expect(comparison).toHaveAttribute('role', 'group');
  await expect(comparison).toHaveAttribute('aria-label', /Scrollable data table/);

  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(comparison).not.toHaveAttribute('data-scroll-tabindex-managed', '');
  await expect(comparison).not.toHaveAttribute('tabindex', '0');
  await expect(comparison).not.toHaveAttribute('role', 'group');

  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/npu-practice.html', { waitUntil: 'networkidle' });
  const table = page.locator('.table-scroll').first();
  await expect(table).toHaveAttribute('tabindex', '0');
  await expect(page.locator('details:not([open]) [data-scroll-tabindex-managed]')).toHaveCount(0);

  const codeQuestion = page
    .locator('details')
    .filter({ has: page.getByText(/^Drill 1\./) })
    .first();
  const answerCode = codeQuestion.locator('.ans pre');
  await expect(codeQuestion).toHaveAttribute('open', '');
  await expect(answerCode).toHaveAttribute('tabindex', '0');
  await expect(answerCode).toHaveAttribute('aria-label', /Scrollable code example: Drill 1\./);

  await codeQuestion.locator('summary').click();
  await expect(answerCode).not.toHaveAttribute('tabindex', '0');

  await codeQuestion.locator('summary').click();
  await expect(answerCode).toHaveAttribute('tabindex', '0');

  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(table).not.toHaveAttribute('tabindex', '0');
});

test('progress trackers recover from corrupted storage and persist valid changes', async ({
  page
}) => {
  const path = '/npu-architecture-performance-study.html';
  const storageKey = 'npu-study:npu-compiler-product-extension';
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(path);
  for (const invalidValue of [
    'null',
    '42',
    'true',
    '"text"',
    '[]',
    '{"compiler-extension":"false"}',
    '{"compiler-extension":1}',
    '{broken'
  ]) {
    await page.evaluate(
      ({ key, value }) => localStorage.setItem(key, value),
      { key: storageKey, value: invalidValue }
    );
    await page.reload();
    await expect(page.locator('#advanced-roadmap [data-progress-value]')).toHaveText(
      '0 / 5 complete'
    );
  }

  const firstStep = page.locator('#advanced-roadmap input[data-step]').first();
  await firstStep.check();
  await expect(page.locator('#advanced-roadmap [data-progress-value]')).toHaveText(
    '1 / 5 complete'
  );
  await page.reload();
  await expect(page.locator('#advanced-roadmap input[data-step]').first()).toBeChecked();
  await expect(page.locator('#advanced-roadmap [data-progress-value]')).toHaveText(
    '1 / 5 complete'
  );
  expect(pageErrors).toEqual([]);
});

test('static progress labels match their checkbox counts without JavaScript', async ({
  browser,
  baseURL
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();

  for (const path of allPages) {
    await page.goto(`${baseURL}${path}`, { waitUntil: 'domcontentloaded' });
    for (const tracker of await page.locator('[data-progress]').all()) {
      const stepCount = await tracker.locator('input[type="checkbox"][data-step]').count();
      await expect(tracker.locator('[data-progress-value]')).toHaveText(
        `0 / ${stepCount} complete`
      );
    }
  }

  await context.close();
});
