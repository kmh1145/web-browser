const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const zlib = require('zlib');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 9090;

// ─── Static files ───
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helper: pick http/https module ───
function getModule(url) {
  return url.startsWith('https') ? https : http;
}

// ─── Proxy endpoint ───
app.get('/proxy', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Missing url param');

  let parsed;
  try {
    parsed = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).send('Invalid protocol');
    }
  } catch {
    return res.status(400).send('Invalid URL');
  }

  const mod = getModule(targetUrl);
  const proxyReq = mod.get(targetUrl, {
    headers: {
      'User-Agent': req.query.ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': req.headers.accept || '*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': parsed.origin,
    },
    timeout: 15000,
    rejectUnauthorized: false,
  }, (proxyRes) => {
    const contentType = (proxyRes.headers['content-type'] || '').toLowerCase();
    const isHtml = contentType.includes('text/html');
    const isCss = contentType.includes('text/css');
    const isJs = contentType.includes('javascript') || contentType.includes('ecmascript');

    // Build safe headers — strip frame-blocking headers
    const headers = { ...proxyRes.headers };
    delete headers['x-frame-options'];
    delete headers['content-security-policy'];
    delete headers['content-security-policy-report-only'];
    delete headers['strict-transport-security'];
    delete headers['cross-origin-opener-policy'];
    delete headers['cross-origin-embedder-policy'];
    delete headers['cross-origin-resource-policy'];

    // Handle redirects
    if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode) && headers.location) {
      try {
        const redirectUrl = new URL(headers.location, targetUrl).href;
        headers.location = `/proxy?url=${encodeURIComponent(redirectUrl)}`;
      } catch {}
    }

    // For non-text content, pipe directly
    if (!isHtml && !isCss && !isJs) {
      delete headers['content-encoding'];
      res.writeHead(proxyRes.statusCode, headers);
      proxyRes.pipe(res);
      return;
    }

    // Decompress and rewrite text content
    const chunks = [];
    proxyRes.on('data', chunk => chunks.push(chunk));
    proxyRes.on('end', () => {
      let buffer = Buffer.concat(chunks);
      const encoding = (proxyRes.headers['content-encoding'] || '').toLowerCase();

      try {
        if (encoding === 'gzip') {
          buffer = zlib.gunzipSync(buffer);
        } else if (encoding === 'deflate') {
          buffer = zlib.inflateSync(buffer);
        } else if (encoding === 'br') {
          buffer = zlib.brotliDecompressSync(buffer);
        }
      } catch {
        // Decompression failed, send raw
        delete headers['content-encoding'];
        res.writeHead(proxyRes.statusCode, headers);
        res.end(buffer);
        return;
      }

      let body = buffer.toString('utf-8');
      const baseUrl = `${parsed.protocol}//${parsed.host}`;

      if (isHtml) {
        // Inject <base> tag for relative URLs
        body = body.replace(/<head([^>]*)>/i, `<head$1><base href="${baseUrl}/">`);

        // Rewrite absolute URLs in src/href/action
        body = body.replace(
          /(src|href|action|poster|data)=(["'])https?:\/\/([^"']*?)\2/gi,
          (m, attr, q, url) => `${attr}=${q}/proxy?url=${encodeURIComponent(`https://${url}`)}${q}`
        );

        // Rewrite protocol-relative URLs
        body = body.replace(
          /(src|href|action)=(["'])\/\/([^"']*?)\2/gi,
          (m, attr, q, url) => `${attr}=${q}/proxy?url=${encodeURIComponent(`https://${url}`)}${q}`
        );

        // Rewrite url() in inline styles
        body = body.replace(
          /url\((["']?)https?:\/\/([^)]+?)\1\)/gi,
          (m, q, url) => `url(${q}/proxy?url=${encodeURIComponent(`https://${url}`)}${q})`
        );

        // Inject base URL meta for JS frameworks
        if (!body.includes('<base ')) {
          body = body.replace(/<head([^>]*)>/i, `<head$1><base href="${baseUrl}/"><meta name="proxy-base" content="${baseUrl}">`);
        }

        // Fix relative URLs that don't start with http
        body = body.replace(
          /(src|href|action)=(["'])(?!https?:|\/proxy|data:|blob:|mailto:|javascript:|#)([^"']*?)\2/gi,
          (m, attr, q, url) => `${attr}=${q}/proxy?url=${encodeURIComponent(`${baseUrl}/${url}`)}${q}`
        );
      }

      delete headers['content-encoding'];
      headers['content-length'] = Buffer.byteLength(body);
      headers['content-type'] = contentType.replace(/;?\s*charset=[^;]*/i, '') + '; charset=utf-8';
      res.writeHead(proxyRes.statusCode, headers);
      res.end(body);
    });
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.status(502).send(`Proxy error: ${err.message}`);
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.status(504).send('Gateway timeout');
    }
  });
});

// ─── Favicon proxy ───
app.get('/favicon', (req, res) => {
  const domain = req.query.domain;
  if (!domain) return res.status(400).send('Missing domain');

  function fetchFavicon(faviconUrl, redirects = 0) {
    if (redirects > 3) return res.status(502).end();
    const mod = faviconUrl.startsWith('https') ? https : http;
    mod.get(faviconUrl, { timeout: 5000 }, (proxyRes) => {
      if ([301, 302, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
        return fetchFavicon(proxyRes.headers.location, redirects + 1);
      }
      res.writeHead(proxyRes.statusCode || 200, {
        'content-type': proxyRes.headers['content-type'] || 'image/png',
        'cache-control': 'public, max-age=86400',
      });
      proxyRes.pipe(res);
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
