const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// Load .env from Drupal root (web/modules/custom/commerce_stablepay/node/ → ../../../../..)
const envPath = path.resolve(__dirname, '../../../../../.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}

const initSqlJs = require('sql.js');
const { ethers } = require('ethers');

for (const level of ['log', 'warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => original(`[${new Date().toISOString()}]`, ...args);
}

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const DRUPAL_BASE_URL = process.env.DRUPAL_BASE_URL || 'http://nginx';
const DRUPAL_HOST = process.env.DRUPAL_HOST || 'store.localhost';
const DB_PATH = process.env.STABLEPAY_DB_PATH || './pending.db';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const masterXpub = process.env.STABLEPAY_MASTER_XPUB || '';

const _baseUrl = new URL(DRUPAL_BASE_URL);
const drupalClient = _baseUrl.protocol === 'https:' ? https : http;
const drupalPort = _baseUrl.port || (_baseUrl.protocol === 'https:' ? 443 : 80);

process.on('unhandledRejection', (err) => {
  if (err && err.code === 'UNKNOWN_ERROR' && err.error?.code === 35) {
    console.warn('RPC subscription not supported on this provider, polling will be used');
    return;
  }
  console.error('Unhandled rejection:', err);
});

function deriveWallet(orderId) {
  if (!masterXpub) throw new Error('STABLEPAY_MASTER_XPUB not set');
  const index = typeof orderId === 'number' ? orderId : parseInt(String(orderId).slice(-7), 16);
  const node = ethers.HDNodeWallet.fromExtendedKey(masterXpub);
  return node.deriveChild(index);
}

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

const subscriptions = new Map();
const reconnectRetries = new Map();
const addressOrderMap = new Map();
const addressNetworkMap = new Map();
const POLL_INTERVAL = 15 * 1000;
let pollTimer = null;
let running = false;
let wsActive = false;
let notifyUrl = '';
const expirationTimers = new Map();
let db = null;
let networkConfig = [];

function httpToWs(url) {
  const ws = url.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  if (ws.includes('forno.celo.org') && !ws.endsWith('/ws')) {
    return ws + '/ws';
  }
  if (ws.includes('arb1.arbitrum.io') && ws.endsWith('/rpc')) {
    return ws.replace(/\/rpc$/, '/ws');
  }
  if (ws.includes('polygon-rpc.com') && !ws.endsWith('/ws')) {
    return ws + '/ws';
  }
  return ws;
}

function resolveNetLabel(rpc_url, token_address) {
  const net = networkConfig.find(n =>
    n.rpc_url === rpc_url && (!token_address || n.token_address.toLowerCase() === token_address.toLowerCase())
  );
  return net ? `${net.name}/${net.network}` : (rpc_url || 'unknown');
}

// --- Persistence (sql.js) ---

async function initDb() {
  const SQL = await initSqlJs();
  let buffer;
  try { buffer = fs.readFileSync(DB_PATH); } catch {}
  db = new SQL.Database(buffer);
  db.run(`CREATE TABLE IF NOT EXISTS pending (
    address TEXT PRIMARY KEY,
    order_id INTEGER,
    rpc_url TEXT,
    token_address TEXT,
    token_symbol TEXT,
    expected_amount TEXT,
    expires_at INTEGER
  )`);
  const rows = db.exec('SELECT * FROM pending');
  const now = Date.now();
  let restored = 0;
  for (const row of rows[0]?.values || []) {
    if (row[6] && now > row[6]) {
      db.run('DELETE FROM pending WHERE address = ?', [row[0]]);
      continue;
    }
    addressOrderMap.set(row[0], row[1]);
    addressNetworkMap.set(row[0], {
      order_id: row[1],
      rpc_url: row[2],
      token_address: row[3],
      token_symbol: row[4],
      expected_amount: row[5],
      expires_at: row[6],
    });
    scheduleExpirationTimer(row[0], { order_id: row[1], expires_at: row[6] });
    restored++;
  }
  if (restored > 0 && !pollTimer) startPolling();
  const buf = Buffer.from(db.export());
  fs.writeFileSync(DB_PATH, buf);
}

function savePending(addr, info) {
  if (!db) return;
  db.run('INSERT OR REPLACE INTO pending VALUES (?, ?, ?, ?, ?, ?, ?)',
    [addr, info.order_id, info.rpc_url, info.token_address, info.token_symbol, info.expected_amount, info.expires_at]);
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

function deletePending(addr) {
  if (!db) return;
  db.run('DELETE FROM pending WHERE address = ?', [addr]);
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

function scheduleExpirationTimer(addr, info) {
  if (!info.expires_at) return;
  if (expirationTimers.has(addr)) return;
  const delay = info.expires_at - Date.now();
  if (delay <= 0) {
    console.log(`Payment expired (restored): order=${info.order_id} addr=${addr} net=${resolveNetLabel(info.rpc_url || '', info.token_address || '')}`);
    notifyExpired(info.order_id).then(() => {
      addressNetworkMap.delete(addr);
      addressOrderMap.delete(addr);
      deletePending(addr);
      cleanupEmptySubscriptions();
    });
    return;
  }
  const timer = setTimeout(async () => {
    expirationTimers.delete(addr);
    console.log(`Payment expired: order=${info.order_id} addr=${addr} net=${resolveNetLabel(info.rpc_url || '', info.token_address || '')} token=${info.token_symbol || 'token'}`);
    await notifyExpired(info.order_id);
    addressNetworkMap.delete(addr);
    addressOrderMap.delete(addr);
    deletePending(addr);
    cleanupEmptySubscriptions();
  }, delay);
  expirationTimers.set(addr, timer);
}

function cancelExpirationTimer(addr) {
  if (expirationTimers.has(addr)) {
    clearTimeout(expirationTimers.get(addr));
    expirationTimers.delete(addr);
  }
}

// --- HD Wallet ---

function deriveAddress(orderId) {
  if (!masterXpub) return null;
  const child = deriveWallet(orderId);
  return child.address;
}

// --- Blockchain Monitor ---

async function subscribeNetwork(net) {
  const netKey = net.token_address.toLowerCase();
  if (subscriptions.has(netKey)) return;

  const wsUrl = httpToWs(net.rpc_url);
  const subState = { intentionalClose: false };
  let provider;
  try {
    provider = new ethers.WebSocketProvider(wsUrl, undefined, { staticNetwork: true });
  } catch (err) {
    console.warn(`WS connect failed on ${net.name} (${wsUrl}): ${err.message}`);
    return;
  }

  provider.websocket.addEventListener('close', (event) => {
    console.warn(`WS disconnected on ${net.name}: code=${event.code} reason=${event.reason || 'none'}`);
    subscriptions.delete(netKey);
    wsActive = subscriptions.size > 0;

    if (subState.intentionalClose) {
      console.log(`WS closed intentionally on ${net.name}, no reconnect`);
      return;
    }
    if (addressNetworkMap.size === 0) {
      console.warn(`WS not reconnecting on ${net.name}, no active addresses`);
      return;
    }
    const stillWatchingThisNet = [...addressNetworkMap.values()].some(info =>
      info.rpc_url === net.rpc_url &&
      info.token_address.toLowerCase() === net.token_address.toLowerCase()
    );
    if (!stillWatchingThisNet) {
      console.warn(`WS not reconnecting on ${net.name}, no active addresses on this network`);
      return;
    }

    const maxRetries = 3;
    let retries = reconnectRetries.get(netKey) || 0;
    const reconnect = () => {
      if (retries >= maxRetries || addressNetworkMap.size === 0) {
        console.warn(`WS reconnect failed on ${net.name} after ${retries} attempts, polling`);
        reconnectRetries.delete(netKey);
        startPolling();
        return;
      }
      retries++;
      reconnectRetries.set(netKey, retries);
      console.log(`WS reconnecting to ${net.name} (attempt ${retries}/${maxRetries})...`);
      setTimeout(() => subscribeNetwork(net).then(() => {
        if (!subscriptions.has(netKey)) reconnect();
      }).catch(() => reconnect()), 3000);
    };
    reconnect();
  });
  provider.websocket.addEventListener('error', (err) => {
    console.error(`WS error on ${net.name}:`, (err.message || '').slice(0, 80));
  });
  provider.websocket.addEventListener('message', (msg) => {
    try {
      const data = JSON.parse(typeof msg.data === 'string' ? msg.data : msg.data.toString());
      if (data.error) {
        console.warn(`WS subscription rejected on ${net.name} (code ${data.error.code}), polling will be used`);
        provider.websocket.close();
      }
    } catch {}
  });

  const contract = new ethers.Contract(net.token_address, ERC20_ABI, provider);

  contract.on('Transfer', async (from, to, value, event) => {
    const addr = to.toLowerCase();
    const orderId = addressOrderMap.get(addr);
    if (orderId) {
      const decimals = await contract.decimals().catch(() => 6n);
      const humanAmount = ethers.formatUnits(value, decimals);
      const txHash = (event.log && event.log.transactionHash) || event.transactionHash;
      console.log(`[monitor] ws-transfer net=${net.name}/${net.network} to=${addr} value=${humanAmount} ${net.token_symbol} tx=${txHash} order=${orderId}`);
      await notifyDrupal(orderId, txHash, humanAmount, net.token_symbol);
      cancelExpirationTimer(addr);
      addressNetworkMap.delete(addr);
      addressOrderMap.delete(addr);
      deletePending(addr);
      cleanupEmptySubscriptions();
    }
  });

  wsActive = true;
  stopPolling();
  const watchedAddrs = [...addressNetworkMap.entries()]
    .filter(([, info]) =>
      info.rpc_url === net.rpc_url &&
      info.token_address.toLowerCase() === net.token_address.toLowerCase()
    )
    .map(([a]) => a);
  console.log(`WS connected on ${net.name} (${net.network}) rpc=${net.rpc_url} token=${net.token_address} ws=${wsUrl} watching=${watchedAddrs.length ? watchedAddrs.join(',') : 'none'}`);
  subscriptions.set(netKey, { name: net.name, provider, contract, rpc_url: net.rpc_url, token_address: net.token_address, subState });
}

async function pollAllAddresses() {
  if (addressNetworkMap.size === 0) {
    stopPolling();
    cleanupSubscriptions();
    return;
  }

  for (const [addr, info] of addressNetworkMap) {
    try {
      const provider = new ethers.JsonRpcProvider(info.rpc_url, undefined, {
        batchMaxCount: 1,
        staticNetwork: true,
      });

      const decHex = await provider.send('eth_call', [{
        to: info.token_address,
        data: '0x313ce567',
      }, 'latest']);
      const decimals = parseInt(decHex.slice(-2), 16);

      const balData = '0x70a08231' + addr.slice(2).padStart(64, '0');
      const balHex = await provider.send('eth_call', [{
        to: info.token_address,
        data: balData,
      }, 'latest']);
      const balance = BigInt(balHex);
      const expected = ethers.parseUnits(info.expected_amount || '0', decimals);

      if (balance >= expected && expected > 0n) {
        const humanAmount = ethers.formatUnits(balance, decimals);
        const currentBlock = await provider.getBlockNumber();
        const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
        const paddedAddr = '0x' + '0'.repeat(24) + addr.slice(2);
        const logs = await provider.send('eth_getLogs', [{
          address: info.token_address,
          fromBlock: '0x' + Math.max(0, currentBlock - 1000).toString(16),
          toBlock: 'latest',
          topics: [transferTopic, null, paddedAddr],
        }]);
        const lastLog = logs.length > 0 ? logs[logs.length - 1] : null;
        console.log(`[monitor] poll-detected net=${resolveNetLabel(info.rpc_url, info.token_address)} order=${info.order_id} addr=${addr} balance=${humanAmount} ${info.token_symbol} tx=${lastLog ? lastLog.transactionHash : 'none'}`);
        await notifyDrupal(info.order_id, lastLog ? lastLog.transactionHash : '', humanAmount, info.token_symbol);
        cancelExpirationTimer(addr);
        addressNetworkMap.delete(addr);
        addressOrderMap.delete(addr);
        deletePending(addr);
      }
    } catch (err) {
      console.error(`Poll error for ${addr}: ${err.message}`);
    }
  }

  if (addressNetworkMap.size === 0) {
    stopPolling();
  }
  cleanupEmptySubscriptions();
}

function cleanupSubscriptions() {
  if (subscriptions.size === 0) return;
  console.log(`Cleaning up ${subscriptions.size} WS subscriptions (no active addresses)`);
  for (const [key, sub] of subscriptions) {
    try { sub.provider.websocket.close(); } catch {}
  }
  subscriptions.clear();
  wsActive = false;
}

function cleanupEmptySubscriptions() {
  for (const [netKey, sub] of subscriptions) {
    const stillWatching = [...addressNetworkMap.values()].some(info =>
      info.rpc_url === sub.rpc_url &&
      info.token_address.toLowerCase() === sub.token_address.toLowerCase()
    );
    if (!stillWatching) {
      console.log(`Cleaning up WS subscription for ${sub.name} (no active addresses)`);
      if (sub.subState) sub.subState.intentionalClose = true;
      try { sub.provider.websocket.close(); } catch {}
      subscriptions.delete(netKey);
    }
  }
  wsActive = subscriptions.size > 0;
  if (!wsActive && addressNetworkMap.size > 0) {
    checkPollFallback();
  }
}

async function notifyDrupal(orderId, txHash, amount, currency) {
  if (!txHash) return;
  if (!notifyUrl) return;
  try {
    const notifyPath = new URL(notifyUrl).pathname;
    const body = JSON.stringify({
      order_id: orderId,
      tx_hash: txHash,
      amount: String(amount),
      currency: currency,
    });
    const status = await new Promise((resolve, reject) => {
      const opts = {
        hostname: _baseUrl.hostname,
        port: drupalPort,
        path: notifyPath,
        method: 'POST',
        rejectUnauthorized: false,
        headers: {
          'Host': DRUPAL_HOST,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...(WEBHOOK_SECRET ? { 'X-Webhook-Secret': WEBHOOK_SECRET } : {}),
        },
      };
      const req = drupalClient.request(opts, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    console.log(`[monitor] notify-drupal order=${orderId} tx=${txHash} status=${status}`);
  } catch (err) {
    console.error(`Notify failed for order ${orderId}: ${err.message}`);
  }
}

async function notifyExpired(orderId) {
  if (!notifyUrl) return;
  try {
    const notifyPath = new URL(notifyUrl).pathname;
    const body = JSON.stringify({ order_id: orderId, event: 'expired' });
    await new Promise((resolve, reject) => {
      const opts = {
        hostname: _baseUrl.hostname,
        port: drupalPort,
        path: notifyPath,
        method: 'POST',
        rejectUnauthorized: false,
        headers: {
          'Host': DRUPAL_HOST,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...(WEBHOOK_SECRET ? { 'X-Webhook-Secret': WEBHOOK_SECRET } : {}),
        },
      };
      const req = drupalClient.request(opts, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    console.log(`Notified Drupal: order ${orderId} expired`);
  } catch (err) {
    console.error(`Notify expired failed for order ${orderId}: ${err.message}`);
  }
}

function startPolling() {
  if (pollTimer) return;
  running = true;
  pollTimer = setInterval(pollAllAddresses, POLL_INTERVAL);
  console.log('Started polling fallback');
}

function stopPolling() {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
  running = false;
  console.log('Stopped polling (WebSocket active)');
}

function ensureNetworkSubscription(rpc_url, token_address) {
  const net = networkConfig.find(n =>
    n.rpc_url === rpc_url && n.token_address.toLowerCase() === token_address.toLowerCase()
  );
  if (net) {
    console.log(`[monitor] subscribe-request net=${net.name}/${net.network} rpc=${net.rpc_url} token=${net.token_address}`);
    subscribeNetwork(net).catch(() => {});
  } else {
    console.warn(`No network config found for ${token_address} (rpc: ${rpc_url})`);
  }
}

function checkPollFallback() {
  if (!wsActive && addressNetworkMap.size > 0) {
    startPolling();
  }
}

// --- HTTP API ---

app.post('/derive', (req, res) => {
  try {
    const { rpc_url, token_address, token_symbol, expected_amount, expiration_minutes } = req.body;
    const order_id = parseInt(req.body.order_id);
    if (isNaN(order_id)) {
      return res.status(400).json({ error: 'Invalid order_id' });
    }
    if (!masterXpub) {
      return res.status(400).json({ error: 'STABLEPAY_MASTER_XPUB not set' });
    }
    const child = deriveWallet(order_id);
    const addr = child.address.toLowerCase();
    addressOrderMap.set(addr, order_id);

    if (rpc_url && token_address) {
      console.log(`[monitor] derive order=${order_id} net=${resolveNetLabel(rpc_url, token_address)} rpc=${rpc_url} token=${token_address} addr=${addr}`);
      const expires_at = Date.now() + (parseInt(expiration_minutes) || 30) * 60 * 1000;
      const info = {
        order_id,
        rpc_url,
        token_address,
        token_symbol: token_symbol || 'USDT',
        expected_amount: expected_amount || '0',
        expires_at,
      };
      addressNetworkMap.set(addr, info);
      savePending(addr, info);
      scheduleExpirationTimer(addr, info);
      ensureNetworkSubscription(rpc_url, token_address);
    }

    res.json({ address: child.address });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/webhook', (req, res) => {
  const { order_id, tx_hash, amount, currency } = req.body;
  if (!order_id || !tx_hash) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  notifyDrupal(order_id, tx_hash, amount, currency);
  res.json({ status: 'ok' });
});

app.get('/balance/:orderId', async (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId);
    const { rpc_url, token_address, token_symbol, expected_amount } = req.query;
    if (!rpc_url || !token_address) {
      return res.json({ balance: '0', expected: '0', found: false });
    }

    const child = deriveWallet(orderId);
    const addr = child.address.toLowerCase();

    const provider = new ethers.JsonRpcProvider(rpc_url, undefined, {
      batchMaxCount: 1, staticNetwork: true,
    });
    const decHex = await provider.send('eth_call', [{
      to: token_address, data: '0x313ce567',
    }, 'latest']);
    const decimals = parseInt(decHex.slice(-2), 16);
    const balData = '0x70a08231' + addr.slice(2).padStart(64, '0');
    const balHex = await provider.send('eth_call', [{
      to: token_address, data: balData,
    }, 'latest']);
    const balance = ethers.formatUnits(BigInt(balHex), decimals);
    res.json({ balance, expected: expected_amount || '0', token_symbol: token_symbol || 'USDT', found: true, address: addr });
  } catch (err) {
    console.error(`BALANCE error ${req.params.orderId}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/get-tx/:orderId', async (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId);
    const { rpc_url, token_address } = req.query;
    if (!rpc_url || !token_address) {
      return res.status(400).json({ error: 'Missing rpc_url or token_address' });
    }

    const child = deriveWallet(orderId);
    const addr = child.address.toLowerCase();

    const provider = new ethers.JsonRpcProvider(rpc_url, undefined, {
      batchMaxCount: 1, staticNetwork: true,
    });
    const currentBlock = await provider.getBlockNumber();
    const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const paddedAddr = '0x' + '0'.repeat(24) + addr.slice(2);

    const logs = await provider.send('eth_getLogs', [{
      address: token_address,
      fromBlock: '0x' + Math.max(0, currentBlock - 5000).toString(16),
      toBlock: 'latest',
      topics: [transferTopic, null, paddedAddr],
    }]);

    const lastLog = logs.length > 0 ? logs[logs.length - 1] : null;
    res.json({ tx_hash: lastLog ? lastLog.transactionHash : null, address: addr });
  } catch (err) {
    console.error(`GETTX error ${req.params.orderId}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    xpub: !!masterXpub,
    ws: wsActive,
    polling: !!pollTimer,
    subscriptions: subscriptions.size,
    addresses: addressOrderMap.size,
    networks: [...subscriptions.values()].map(s => s.name),
  });
});

// --- Startup ---

async function fetchConfig() {
  try {
    const config = await new Promise((resolve, reject) => {
      const opts = {
        hostname: _baseUrl.hostname,
        port: drupalPort,
        path: '/stablepay/payment/config',
        method: 'GET',
        rejectUnauthorized: false,
        headers: { 'Host': DRUPAL_HOST },
      };
      const req = drupalClient.request(opts, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          if (res.statusCode === 200) {
            try { resolve(JSON.parse(body)); }
            catch (e) { reject(e); }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
          }
        });
      });
      req.on('error', reject);
      req.end();
    });
    return config;
  } catch (err) {
    console.error('Failed to fetch config from Drupal:', err.message);
    return null;
  }
}

async function start() {
  await initDb();

  if (!masterXpub) {
    console.error('STABLEPAY_MASTER_XPUB not set in env');
    return;
  }

  // Fetch networks/notify_url/sweep_address from Drupal (no seed in response)
  let config = null;
  for (let i = 0; i < 5 && !config; i++) {
    await new Promise(r => setTimeout(r, 3000));
    config = await fetchConfig();
  }
  if (config) {
    notifyUrl = config.notify_url || notifyUrl;
    networkConfig = config.networks || [];
    running = true;

    for (const [addr, info] of addressNetworkMap) {
      ensureNetworkSubscription(info.rpc_url, info.token_address);
    }

    checkPollFallback();
  }

  app.listen(PORT, () => {
    console.log(`StablePay sidecar listening on port ${PORT}`);
  });
}

start().catch(err => console.error('Sidecar startup failed:', err.message));

process.on('SIGTERM', () => {
  running = false;
  if (pollTimer) clearInterval(pollTimer);
  for (const sub of subscriptions.values()) {
    try {
      if (sub.provider && sub.provider.websocket) sub.provider.websocket.close();
    } catch (_) {}
  }
  if (db) {
    fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
    db.close();
  }
  process.exit(0);
});
