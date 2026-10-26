// Tiny read-only Mercury stand-in for e2e/CI: node test/mock-mercury.mjs (port 4010, token secret-token:mock)
import http from 'node:http';
const ACC = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const now = Date.now(), d = (days) => new Date(now - days * 864e5).toISOString();
const tx = (id, amount, days, extra = {}) => ({ id, amount, status: 'sent', kind: 'debitCardTransaction', counterpartyName: 'AWS', bankDescription: 'AWS EMEA', note: null, mercuryCategory: 'Software', cardId: 'c1', createdAt: d(days), postedAt: d(days), ...extra });
const txs = [tx('t1', -1234.56, 40), tx('t2', -0.1, 70), tx('t3', 5000, 50, { counterpartyName: 'Client' }), tx('t4', -99.99, 2, { counterpartyName: '=cmd|calc', mercuryCategory: null, status: 'pending' })];
http.createServer((req, res) => {
  if (req.headers.authorization !== 'Bearer secret-token:mock') { res.writeHead(401); return res.end('{}'); }
  if (req.method !== 'GET') { res.writeHead(405); return res.end('{}'); }
  const u = new URL(req.url, 'http://x'); res.setHeader('content-type', 'application/json');
  if (u.pathname === '/api/v1/accounts') return res.end(JSON.stringify({ accounts: [{ id: ACC, name: 'Checking', nickname: null, status: 'active', availableBalance: 10000, currentBalance: 10050.25 }], page: {} }));
  if (u.pathname === `/api/v1/account/${ACC}`) return res.end(JSON.stringify({ id: ACC, name: 'Checking', nickname: null, status: 'active', availableBalance: 10000, currentBalance: 10050.25 }));
  if (u.pathname === `/api/v1/account/${ACC}/transactions`) return res.end(JSON.stringify({ total: txs.length, transactions: Number(u.searchParams.get('offset') ?? 0) ? [] : txs }));
  res.writeHead(404); res.end('{}');
}).listen(4010, () => console.log('mock on 4010'));
