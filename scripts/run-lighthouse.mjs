import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const { launch } = require('chrome-launcher');
const lighthouseCi = require.resolve('@lhci/cli/src/cli.js');
const userDataDir = await mkdtemp(join(tmpdir(), 'npu-lighthouse-'));
const lighthouseTimeoutMs = 5 * 60_000;

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();

  return new Promise((resolve) => {
    const onClose = () => {
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      child.off('close', onClose);
      resolve();
    }, timeoutMs);
    child.once('close', onClose);
  });
}

let browser;
let lighthouseChild;
let lighthouseStatus = 1;
let terminationReason;
let forceKillTimer;

function terminateLighthouse(force = false) {
  if (!lighthouseChild || lighthouseChild.exitCode !== null || lighthouseChild.signalCode !== null) {
    return;
  }

  if (process.platform === 'win32') {
    spawnSync(
      'taskkill',
      ['/pid', String(lighthouseChild.pid), '/T', '/F'],
      { stdio: 'ignore', windowsHide: true }
    );
    return;
  }

  try {
    process.kill(-lighthouseChild.pid, force ? 'SIGKILL' : 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function requestTermination(reason) {
  if (terminationReason) {
    terminateLighthouse(true);
    return;
  }

  terminationReason = reason;
  terminateLighthouse();
  if (process.platform !== 'win32') {
    forceKillTimer = setTimeout(() => terminateLighthouse(true), 5000);
  }
}

const signalHandlers = {
  SIGINT: () => requestTermination('SIGINT'),
  SIGTERM: () => requestTermination('SIGTERM')
};
for (const [signal, handler] of Object.entries(signalHandlers)) {
  process.on(signal, handler);
}

function runLighthouse() {
  return new Promise((resolve, reject) => {
    lighthouseChild = spawn(
      process.execPath,
      [lighthouseCi, 'autorun', `--collect.settings.port=${browser.port}`],
      {
        detached: process.platform !== 'win32',
        stdio: 'inherit',
        windowsHide: true,
        env: {
          ...process.env,
          CHROME_PATH: chromium.executablePath()
        }
      }
    );
    if (terminationReason) terminateLighthouse();

    const timeout = setTimeout(() => requestTermination('timeout'), lighthouseTimeoutMs);
    const finish = (callback) => {
      clearTimeout(timeout);
      clearTimeout(forceKillTimer);
      callback();
    };

    lighthouseChild.once('error', (error) => finish(() => reject(error)));
    lighthouseChild.once('close', (code) =>
      finish(() => {
        if (terminationReason === 'timeout') {
          reject(new Error(`Lighthouse exceeded its ${lighthouseTimeoutMs / 1000}-second timeout`));
          return;
        }
        resolve(code ?? 1);
      })
    );
  });
}

try {
  browser = await launch({
    chromePath: chromium.executablePath(),
    chromeFlags: ['--headless=new', '--no-sandbox'],
    handleSIGINT: false,
    logLevel: 'error',
    userDataDir
  });
  if (!terminationReason) lighthouseStatus = await runLighthouse();
} finally {
  clearTimeout(forceKillTimer);
  terminateLighthouse(true);
  if (browser) {
    browser.kill();
    await waitForExit(browser.process, 5000);
  }

  try {
    await rm(userDataDir, { force: true, maxRetries: 10, recursive: true, retryDelay: 100 });
  } catch (error) {
    process.stderr.write(`Warning: could not remove Lighthouse profile: ${error.message}\n`);
  }
  for (const [signal, handler] of Object.entries(signalHandlers)) {
    process.off(signal, handler);
  }
  clearTimeout(forceKillTimer);
}

if (terminationReason === 'SIGINT') process.exitCode = 130;
else if (terminationReason === 'SIGTERM') process.exitCode = 143;
else process.exitCode = lighthouseStatus;
