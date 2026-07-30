import { expect, test } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { gunzipSync } from 'node:zlib';

const quizDownloadJsonPaths = [
  'data/analog-cim-architecture.json',
  'data/analog-cim-evidence.json',
  'data/analog-cim-mcq.json'
];
const publicSchemaPaths = (await readdir('schemas'))
  .filter((name) => name.endsWith('.schema.json'))
  .sort()
  .map((name) => `schemas/${name}`);

const runtimeJsonPath = (stablePath, release) =>
  stablePath.replace(/\.json$/, `.${release}.json`);

async function loadManifest(request) {
  const response = await request.get('/asset-manifest.json');
  expect(response.ok()).toBeTruthy();
  return response.json();
}

function requestRaw(url, { headers = {}, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { headers, method }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          body: Buffer.concat(chunks),
          headers: response.headers,
          status: response.statusCode
        });
      });
    });
    request.on('error', reject);
    request.end();
  });
}

test('the Pages test server models compressed production delivery', async ({
  baseURL
}) => {
  const assetPath = 'analog-cim-board-bringup.html';
  const [compressed, identity] = await Promise.all([
    requestRaw(new URL(assetPath, baseURL), {
      headers: {
        'Accept-Encoding': 'gzip',
        Connection: 'close'
      }
    }),
    requestRaw(new URL(assetPath, baseURL), {
      headers: {
        'Accept-Encoding': 'gzip;q=0, identity',
        Connection: 'close'
      }
    })
  ]);
  const source = await readFile(`build/pages-site/${assetPath}`);

  expect(compressed.status).toBe(200);
  expect(compressed.headers['content-encoding']).toBe('gzip');
  expect(compressed.headers.vary).toContain('Accept-Encoding');
  expect(gunzipSync(compressed.body).equals(source)).toBeTruthy();

  expect(identity.status).toBe(200);
  expect(identity.headers['content-encoding']).toBeUndefined();
  expect(identity.body.equals(source)).toBeTruthy();
});

test('the packaged manifest, stable JSON aliases, and public schemas resolve', async ({
  request
}) => {
  const manifest = await loadManifest(request);
  expect(manifest.schemaVersion).toBe(2);
  expect(manifest.release).toMatch(/^[0-9a-f]{16}$/);

  const recordsByPath = new Map(manifest.files.map((file) => [file.path, file]));
  const stableJsonRecords = manifest.files.filter(
    (file) =>
      file.path.endsWith('.json') &&
      !file.path.endsWith(`.${manifest.release}.json`)
  );
  expect(stableJsonRecords.length).toBeGreaterThanOrEqual(quizDownloadJsonPaths.length);

  for (const stableRecord of stableJsonRecords) {
    const runtimePath = runtimeJsonPath(stableRecord.path, manifest.release);
    const runtimeRecord = recordsByPath.get(runtimePath);
    expect(runtimeRecord, `${stableRecord.path} should have a release-hashed runtime copy`).toEqual({
      path: runtimePath,
      bytes: stableRecord.bytes,
      sha256: stableRecord.sha256
    });

    const [stableResponse, runtimeResponse] = await Promise.all([
      request.get(`/${stableRecord.path}`),
      request.get(`/${runtimePath}`)
    ]);
    expect(stableResponse.ok(), stableRecord.path).toBeTruthy();
    expect(runtimeResponse.ok(), runtimePath).toBeTruthy();
    expect(Buffer.from(await stableResponse.body()).equals(Buffer.from(await runtimeResponse.body())))
      .toBeTruthy();
  }

  const quizHtml = await (await request.get('/analog-cim-quiz.html')).text();
  for (const downloadPath of quizDownloadJsonPaths) {
    expect(recordsByPath.has(downloadPath), downloadPath).toBeTruthy();
    expect(quizHtml).toContain(`href="${downloadPath}"`);
    expect(quizHtml).not.toContain(
      `href="${runtimeJsonPath(downloadPath, manifest.release)}"`
    );
  }

  const schemaRecords = stableJsonRecords.filter((file) =>
    file.path.startsWith('schemas/')
  );
  expect(schemaRecords.map((file) => file.path).sort()).toEqual(publicSchemaPaths);
  for (const schemaRecord of schemaRecords) {
    const schema = await (await request.get(`/${schemaRecord.path}`)).json();
    expect(schema.$id).toBe(
      new URL(schemaRecord.path, 'https://buicongnguyen.github.io/NPU/').href
    );
  }
});

test('every packaged HTML page boots with release-hashed CSS and JavaScript', async ({
  page,
  request,
  baseURL
}) => {
  test.setTimeout(120_000);
  const manifest = await loadManifest(request);
  const htmlPaths = manifest.files
    .map((file) => file.path)
    .filter((path) => path.endsWith('.html'))
    .sort();
  const localFailures = [];

  page.on('requestfailed', (failedRequest) => {
    if (new URL(failedRequest.url()).origin === new URL(baseURL).origin) {
      localFailures.push(
        `${failedRequest.method()} ${failedRequest.url()}: ${failedRequest.failure()?.errorText}`
      );
    }
  });
  page.on('response', (response) => {
    if (
      new URL(response.url()).origin === new URL(baseURL).origin &&
      response.status() >= 400
    ) {
      localFailures.push(`${response.status()} ${response.url()}`);
    }
  });

  for (const htmlPath of htmlPaths) {
    const response = await page.goto(`/${htmlPath}`, { waitUntil: 'networkidle' });
    expect(response?.ok(), htmlPath).toBeTruthy();
    await page.waitForFunction(
      () => document.documentElement.dataset.bookShellReady === 'true'
    );
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toBeVisible();

    const runtimeAssetPaths = await page
      .locator('link[rel="stylesheet"][href], script[src]')
      .evaluateAll((elements) =>
        elements
          .map((element) => new URL(element.href || element.src))
          .filter(
            (url) =>
              url.origin === window.location.origin &&
              /\.(?:css|js)$/.test(url.pathname)
          )
          .map((url) => url.pathname)
      );
    expect(runtimeAssetPaths.length, `${htmlPath} should load local runtime assets`)
      .toBeGreaterThan(0);
    for (const assetPath of runtimeAssetPaths) {
      expect(assetPath, `${htmlPath}: ${assetPath}`).toContain(`.${manifest.release}.`);
    }
  }

  expect(localFailures).toEqual([]);
});

for (const [htmlPath, dataPath, readySelector, expectedCount] of [
  [
    'analog-cim-architecture.html',
    'data/analog-cim-architecture.json',
    '#stage-list button',
    8
  ],
  ['analog-cim-evidence.html', 'data/analog-cim-evidence.json', '#evidence-body tr', 14],
  ['analog-cim-quiz.html', 'data/analog-cim-mcq.json', '#quiz-body [role="radio"]', 4]
]) {
  test(`${htmlPath} requests its release-hashed JSON at runtime`, async ({
    page,
    request
  }) => {
    const manifest = await loadManifest(request);
    const expectedPath = `/${runtimeJsonPath(dataPath, manifest.release)}`;
    let runtimeResponse;
    page.on('response', (response) => {
      if (new URL(response.url()).pathname === expectedPath) runtimeResponse = response;
    });

    await page.goto(`/${htmlPath}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator(readySelector)).toHaveCount(expectedCount);
    await expect
      .poll(() => runtimeResponse?.ok(), {
        message: `${htmlPath} should load ${expectedPath}`
      })
      .toBe(true);
  });
}
