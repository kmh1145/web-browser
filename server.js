const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const zlib = require('zlib');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 9090;

// ─── Connection Pool (keep-alive) ───
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 16 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 16, rejectUnauthorized: false });

// ─── LRU Cache for static assets ───
const CACHE_MAX = 500;
const CACHE_TTL = 5 * 60 * 1000; // 5 min
const assetCache = new Map(); // key -> { body, headers, ts }
function cacheGet(key) {
  const entry = assetCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { assetCache.delete(key); return null; }
  return entry;
}
function cacheSet(key, body, headers) {
  if (assetCache.size >= CACHE_MAX) {
    const oldest = assetCache.keys().next().value;
    assetCache.delete(oldest);
  }
  assetCache.set(key, { body, headers, ts: Date.now() });
}

// ─── Static files ───
app.use(express.static(path.join(__dirname, 'public')));

// ─── MIME-based cacheability check ───
const CACHEABLE_TYPES = /\.(css|js|woff2?|ttf|eot|svg|png|jpe?g|gif|webp|ico|mp4|webm|mp3|ogg)(\?|$)/i;
function isCacheable(url, contentType) {
  if (CACHEABLE_TYPES.test(url)) return true;
  if (contentType && (contentType.includes('image/') || contentType.includes('font/') || contentType.includes('application/javascript'))) return true;
  return false;
}

// ─── URL rewrite helper ───
const ABS_URL_RE = /(src|href|action|poster|data)=([\"'])https?:\/\/([^\"']*?)\2/gi;
const PROTO_REL_RE = /(src|href|action)=([\"'])\/\/([^\"']*?)\2/gi;
const CSS_URL_RE = /url\(([\"']?)https?:\/\/([^)]+?)\1\)/gi;
const REL_URL_RE = /(src|href|action)=([\"'])(?!https?:|\/proxy|data:|blob:|mailto:|javascript:|#)([^\"']*?)\2/gi;
const HEAD_RE = /<head([^>]*)>/i;

function rewriteHtml(body, baseUrl) {
  body = body.replace(HEAD_RE, `<head$1><base href="${baseUrl}/">`);
  body = body.replace(ABS_URL_RE, (m, attr, q, url) => `${attr}=${q}/proxy?url=${encodeURIComponent(`https://${url}`)}${q}`);
  body = body.replace(PROTO_REL_RE, (m, attr, q, url) => `${attr}=${q}/proxy?url=${encodeURIComponent(`https://${url}`)}${q}`);
  body = body.replace(CSS_URL_RE, (m, q, url) => `url(${q}/proxy?url=${encodeURIComponent(`https://${url}`)}${q})`);
  body = body.replace(REL_URL_RE, (m, attr, q, url) => `${attr}=${q}/proxy?url=${encodeURIComponent(`${baseUrl}/${url}`)}${q}`);
  return body;
}

// ─── Proxy endpoint ───
app.get('/proxy', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Missing url param');

  let parsed;
  try {
    parsed = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return res.status(400).send('Invalid protocol');
  } catch { return res.status(400).send('Invalid URL'); }

  // Check cache
  const cacheKey = targetUrl;
  const cached = cacheGet(cacheKey);
  if (cached) {
    res.writeHead(200, cached.headers);
    res.end(cached.body);
    return;
  }

  const mod = parsed.protocol === 'https:' ? https : http;
  const agent = parsed.protocol === 'https:' ? httpsAgent : httpAgent;

  const proxyReq = mod.get(targetUrl, {
    agent,
    headers: {
      'User-Agent': req.query.ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': req.headers.accept || '*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': parsed.origin,
      'Connection': 'keep-alive',
    },
    timeout: 10000,
  }, (proxyRes) => {
    const contentType = (proxyRes.headers['content-type'] || '').toLowerCase();
    const isHtml = contentType.includes('text/html');

    // Build safe headers
    const headers = {};
    const skipHeaders = new Set([
      'x-frame-options', 'content-security-policy', 'content-security-policy-report-only',
      'strict-transport-security', 'cross-origin-opener-policy', 'cross-origin-embedder-policy',
      'cross-origin-resource-policy', 'transfer-encoding',
    ]);
    for (const [k, v] of Object.entries(proxyRes.headers)) {
      if (!skipHeaders.has(k.toLowerCase())) headers[k] = v;
    }

    // Handle redirects
    if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode) && headers.location) {
      try {
        headers.location = `/proxy?url=${encodeURIComponent(new URL(headers.location, targetUrl).href)}`;
      } catch {}
      res.writeHead(proxyRes.statusCode, headers);
      res.end();
      return;
    }

    // Non-HTML: pipe directly with optional caching
    if (!isHtml) {
      const canCache = isCacheable(targetUrl, contentType);
      if (canCache) {
        const chunks = [];
        proxyRes.on('data', c => chunks.push(c));
        proxyRes.on('end', () => {
          const body = Buffer.concat(chunks);
          delete headers['content-encoding'];
          headers['content-length'] = body.length;
          headers['cache-control'] = 'public, max-age=300';
          cacheSet(cacheKey, body, headers);
          res.writeHead(proxyRes.statusCode, headers);
          res.end(body);
        });
      } else {
        delete headers['content-encoding'];
        res.writeHead(proxyRes.statusCode, headers);
        proxyRes.pipe(res);
      }
      return;
    }

    // HTML: decompress → rewrite → respond
    const chunks = [];
    proxyRes.on('data', c => chunks.push(c));
    proxyRes.on('end', () => {
      let buffer = Buffer.concat(chunks);
      const encoding = (proxyRes.headers['content-encoding'] || '').toLowerCase();
      try {
        if (encoding === 'gzip') buffer = zlib.gunzipSync(buffer);
        else if (encoding === 'deflate') buffer = zlib.inflateSync(buffer);
        else if (encoding === 'br') buffer = zlib.brotliDecompressSync(buffer);
      } catch {
        delete headers['content-encoding'];
        res.writeHead(proxyRes.statusCode, headers);
        res.end(buffer);
        return;
      }

      const baseUrl = `${parsed.protocol}//${parsed.host}`;
      let body = rewriteHtml(buffer.toString('utf-8'), baseUrl);

      delete headers['content-encoding'];
      headers['content-length'] = Buffer.byteLength(body);
      headers['content-type'] = contentType.replace(/;?\s*charset=[^;]*/i, '') + '; charset=utf-8';
      res.writeHead(proxyRes.statusCode, headers);
      res.end(body);
    });
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) res.status(502).send(`Proxy error: ${err.message}`);
  });
  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) res.status(504).send('Gateway timeout');
  });
});

// ─── Favicon proxy (cached) ───
const faviconCache = new Map();
app.get('/favicon', (req, res) => {
  const domain = req.query.domain;
  if (!domain) return res.status(400).send('Missing domain');

  const cached = faviconCache.get(domain);
  if (cached && Date.now() - cached.ts < 3600000) {
    res.writeHead(200, { 'content-type': cached.type, 'cache-control': 'public, max-age=86400' });
    res.end(cached.body);
    return;
  }

  function fetchFavicon(faviconUrl, redirects = 0) {
    if (redirects > 3) return res.status(502).end();
    const mod = faviconUrl.startsWith('https') ? https : http;
    mod.get(faviconUrl, { agent: httpsAgent, timeout: 5000 }, (proxyRes) => {
      if ([301, 302, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
        return fetchFavicon(proxyRes.headers.location, redirects + 1);
      }
      const chunks = [];
      proxyRes.on('data', c => chunks.push(c));
      proxyRes.on('end', () => {
        const body = Buffer.concat(chunks);
        const type = proxyRes.headers['content-type'] || 'image/png';
        faviconCache.set(domain, { body, type, ts: Date.now() });
        res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=86400' });
        res.end(body);
      });
    }).on('error', () => res.status(502).end());
  }

  fetchFavicon(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`);
});

// ─── SPA fallback ───
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/proxy') && !req.path.startsWith('/favicon')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    next();
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Web Browser running at http://localhost:${PORT}`);
});
