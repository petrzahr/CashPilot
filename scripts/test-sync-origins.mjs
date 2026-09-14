import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const initial = {
  version: 2, sync: { revision: 0, updatedAt: '', updatedByDeviceId: '' }, deletions: [],
  settings: { currency: 'CZK', budgetStartDay: 15, overdraftLimitInHaler: 2000000, minReserveInHaler: 2000000, forecastMonths: 12, roundAmounts: false },
  accounts: [{ id: 'account', name: 'Test account', type: 'checking', currency: 'CZK', initialBalanceInHaler: 100000,
    isDefault: true, isUsableCash: true, isNetWorth: true, status: 'active', color: '#123456', sortOrder: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }],
  categories: [], recurringRules: [], recurringExceptions: [], corrections: [], marketValueSnapshots: [],
  transactions: [{ id: 'old', title: 'Previously deleted', type: 'expense', amountInHaler: 100, sourceAccountId: 'account',
    date: '2026-09-14', sequence: 1, status: 'executed', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }],
};
let cloud = structuredClone(initial), revision = 0, uploads = 0, conflicts = 0;
let releaseReads, injectConflict = true;
let readGate = new Promise(resolve => { releaseReads = resolve; });
const servers = [], errors = [];
let browser;
try {
  for (const port of [4173, 4174]) {
    const server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true }, plugins: [{
      name: 'sync-test-entry', configureServer(server) {
        server.middlewares.use('/sync-test', (_req, res) => {
          res.setHeader('Content-Type', 'text/html');
          res.end('<div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/scripts/sync-origins-harness.tsx"></script>');
        });
      },
    }] });
    await server.listen(); servers.push(server);
  }
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext();
  await context.addInitScript(() => {
    localStorage.setItem('cashpilot_google_auth_v1', JSON.stringify({ accessToken: 'test-only-token', expiresAt: Date.now() + 3600000 }));
  });
  await context.route('https://www.googleapis.com/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) }).catch(() => {});
    if (url.pathname.endsWith('/about')) return reply({ user: { permissionId: 'test-account', displayName: 'Test account' } });
    if (request.method() === 'GET' && url.pathname.endsWith('/files')) return reply({ files: [{ id: 'file', name: 'cashpilot_data.json' }] });
    if (request.method() === 'GET' && url.searchParams.get('alt') === 'media') {
      await readGate; return reply(cloud);
    }
    if (request.method() === 'GET') return reply({ id: 'file', etag: `"${revision}"`, version: String(revision) });
    if (request.method() === 'PUT') {
      if (injectConflict) { injectConflict = false; revision++; conflicts++; return reply({}, 412); }
      if (request.headers()['if-match'] !== `"${revision}"`) { conflicts++; return reply({}, 412); }
      const body = request.postData();
      const parts = body.split('Content-Type: application/json; charset=UTF-8\r\n\r\n');
      cloud = JSON.parse(parts[2].split('\r\n--')[0]);
      revision++; uploads++;
      return reply({ id: 'file', title: 'cashpilot_data.json' });
    }
    throw new Error(`Unexpected Drive request: ${request.method()} ${url.pathname}`);
  });
  const open = async port => {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/sync-test`);
    await page.waitForFunction(() => !!window.finance);
    return page;
  };
  const ready = page => page.waitForFunction(() => window.finance.isCloudReady);
  const sync = page => page.evaluate(() => window.finance.syncWithGoogleDrive());
  const a = await open(4173), b = await open(4174);
  await a.getByText('Načítám aktuální data z Google Disku…', { exact: true }).waitFor();
  assert.equal(await a.getByRole('button', { name: 'Přidat položku', exact: true }).count(), 0);
  assert.equal(uploads, 0);
  releaseReads(); readGate = Promise.resolve();
  await Promise.all([ready(a), ready(b)]);
  assert.notEqual(await a.evaluate(() => location.origin), await b.evaluate(() => location.origin));
  await b.close(); // Cache at the second origin still contains the old transaction.
  assert.equal(await a.evaluate(() => window.finance.deleteTransaction('old')), true);
  await a.evaluate(() => window.finance.addMainCategory({ name: 'New category', type: 'expense', parentId: null, color: '#123456', sortOrder: 1, status: 'active' }));
  await sync(a);
  assert.equal(cloud.transactions.length, 0);
  const reopened = await open(4174); await ready(reopened); await sync(reopened);
  assert.equal(await reopened.evaluate(() => window.finance.transactions.length), 0);
  assert.equal(await reopened.evaluate(() => window.finance.categories[0].name), 'New category');
  assert.equal(cloud.transactions.length, 0);
  // A mutation is durable before its debounce timer can run, including across page close.
  await reopened.evaluate(() => window.finance.addTransaction({ title: 'Offline', type: 'expense', amountInHaler: 200,
    sourceAccountId: 'account', date: '2026-09-14', sequence: 1, status: 'executed' }));
  await reopened.close();
  const resumed = await open(4174); await ready(resumed); await sync(resumed);
  assert.equal(cloud.transactions.filter(t => t.title === 'Offline').length, 1);
  // Concurrent UI sessions share the mocked cloud but have separate origin storage.
  await sync(a);
  await Promise.all([a, resumed].map((page, i) => page.evaluate(i => window.finance.addTransaction({ title: `Concurrent ${i}`,
    type: 'expense', amountInHaler: 100, sourceAccountId: 'account', date: '2026-09-14', sequence: i + 2, status: 'executed' }), i)));
  await Promise.all([sync(a), sync(resumed)]);
  await Promise.all([sync(a), sync(resumed)]);
  assert.equal(cloud.transactions.filter(t => t.title.startsWith('Concurrent')).length, 2);
  assert.equal(cloud.transactions.some(t => t.id === 'old'), false);
  assert.equal(await a.evaluate(() => window.finance.driveSyncStatus), 'synced');
  assert.equal(await resumed.evaluate(() => window.finance.driveSyncStatus), 'synced');
  assert.ok(conflicts >= 1);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', origins: ['http://127.0.0.1:4173', 'http://127.0.0.1:4174'], uploads, conflicts,
    checks: ['initial edit gate', 'stale cache deletion', 'new category', 'close before debounce', 'concurrent edits', 'confirmed status', 'React StrictMode'],
    realGoogleAccount: false }, null, 2));
} finally {
  await browser?.close();
  await Promise.all(servers.map(server => server.close()));
}
