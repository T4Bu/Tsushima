import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const outputDir = path.join(root, 'captures');
const baseUrl = process.env.BIOME_URL || 'http://127.0.0.1:4173';
const fallbackPlaywright = 'C:/source/bluestem/node_modules/playwright/index.mjs';

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    return import(pathToFileURL(fallbackPlaywright).href);
  }
}

async function responds(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer(url, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await responds(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Biome server did not become ready at ${url}`);
}

await mkdir(outputDir, { recursive: true });
let server = null;
if (!(await responds(baseUrl))) {
  server = spawn(
    process.execPath,
    [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '4173'],
    { cwd: root, stdio: 'ignore', windowsHide: true },
  );
  await waitForServer(baseUrl);
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});

const shots = ['entry', 'reveal', 'meadow', 'river', 'tree'];
const manifest = {
  generatedAt: new Date().toISOString(),
  viewport: { width: 1600, height: 900 },
  fixedTimeSeconds: 18.5,
  shots: [],
};

try {
  for (const shot of shots) {
    const page = await browser.newPage({ viewport: manifest.viewport });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(`${baseUrl}/?shot=${shot}&time=${manifest.fixedTimeSeconds}&quality=high`, {
      waitUntil: 'networkidle',
      timeout: 60_000,
    });
    await page.waitForFunction(() => window.__BIOME_READY__ === true, null, { timeout: 60_000 });
    await page.waitForTimeout(750);
    const output = path.join(outputDir, `${shot}.png`);
    await page.screenshot({ path: output, type: 'png' });
    const stats = await page.evaluate(() => window.__BIOME_STATS__);
    manifest.shots.push({ shot, file: path.basename(output), errors, stats });
    await page.close();
  }
} finally {
  await browser.close();
  if (server) server.kill();
}

await writeFile(
  path.join(outputDir, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);

const errorCount = manifest.shots.reduce((sum, shot) => sum + shot.errors.length, 0);
console.log(`Captured ${manifest.shots.length} views to ${outputDir} (${errorCount} browser errors).`);
if (errorCount) process.exitCode = 1;
