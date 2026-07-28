import { readdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('all rendered internal links and anchors resolve', async ({ browser, baseURL }) => {
  test.setTimeout(90_000);

  const htmlFiles = (await readdir(process.cwd()))
    .filter((name) => name.endsWith('.html'))
    .sort();
  const context = await browser.newContext();
  const sourcePage = await context.newPage();
  const baseOrigin = new URL(baseURL).origin;
  const targetsByDocument = new Map();

  for (const file of htmlFiles) {
    const response = await sourcePage.goto(`${baseURL}/${file}`, { waitUntil: 'networkidle' });
    expect(response?.ok(), `${file} should load`).toBeTruthy();
    const links = await sourcePage.locator('a[href]').evaluateAll((anchors) =>
      anchors.map((anchor) => anchor.href)
    );
    for (const link of links) {
      const url = new URL(link);
      expect(
        ['http:', 'https:'],
        `${file} renders a link with the disallowed ${url.protocol} protocol: ${link}`
      ).toContain(url.protocol);
      if (url.origin === baseOrigin) {
        const documentUrl = `${url.origin}${url.pathname}${url.search}`;
        const fragments = targetsByDocument.get(documentUrl) ?? new Set();
        fragments.add(url.hash);
        targetsByDocument.set(documentUrl, fragments);
      }
    }
  }

  const targetPage = await context.newPage();
  const sortedTargets = [...targetsByDocument.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  );
  for (const [documentUrl, fragments] of sortedTargets) {
    const url = new URL(documentUrl);
    const hasFragments = [...fragments].some((fragment) => fragment.length > 1);
    if (!url.pathname.endsWith('.html') && !hasFragments) {
      const response = await context.request.get(documentUrl);
      expect(response.ok(), `${documentUrl} should load`).toBeTruthy();
      continue;
    }
    const response = await targetPage.goto(documentUrl, {
      waitUntil: 'networkidle'
    });
    expect(response?.ok(), `${documentUrl} should load`).toBeTruthy();
    for (const fragment of fragments) {
      if (fragment.length <= 1) continue;
      const id = decodeURIComponent(fragment.slice(1));
      const exists = await targetPage.evaluate(
        (targetId) => Boolean(document.getElementById(targetId)),
        id
      );
      expect(
        exists,
        `${documentUrl}${fragment} should reference an existing rendered ID`
      ).toBeTruthy();
    }
  }

  await context.close();
});
