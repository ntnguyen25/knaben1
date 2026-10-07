import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';
import {
  scrapeKnaben,
  formatStremioStreams,
  resolveStremioMedia,
  fetchCatalogMetas,
  TorrentItem,
  ScraperConfig
} from './src/services/knabenService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT: number = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Enable CORS and allow iframe embedding for Stremio
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
  res.setHeader('Access-Control-Max-Age', '86400');
  // Allow Stremio desktop & web app iframe embedding for /configure
  res.setHeader('Content-Security-Policy', "frame-ancestors *");
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(express.json());

// Helper to parse configuration
function parseConfig(configStr?: string, queryParams: any = {}): ScraperConfig {
  const config: ScraperConfig = {
    minSeeds: queryParams.minSeeds ? parseInt(queryParams.minSeeds, 10) : 0,
    maxResults: queryParams.maxResults ? parseInt(queryParams.maxResults, 10) : 50,
    qualityFilter: queryParams.qualityFilter || 'all',
    sortBy: queryParams.sortBy || 'seeds'
  };

  if (configStr && configStr !== 'manifest.json' && configStr !== 'configure') {
    if (configStr.includes('=')) {
      const params = new URLSearchParams(configStr);
      if (params.has('minSeeds')) config.minSeeds = parseInt(params.get('minSeeds')!, 10);
      if (params.has('maxResults')) config.maxResults = parseInt(params.get('maxResults')!, 10);
      if (params.has('qualityFilter')) config.qualityFilter = params.get('qualityFilter')!;
      if (params.has('sortBy')) config.sortBy = params.get('sortBy') as any;
    } else {
      try {
        const jsonStr = Buffer.from(configStr, 'base64').toString('utf-8');
        const parsed = JSON.parse(jsonStr);
        if (typeof parsed === 'object' && parsed !== null) {
          if (parsed.minSeeds !== undefined) config.minSeeds = parseInt(parsed.minSeeds, 10);
          if (parsed.maxResults !== undefined) config.maxResults = parseInt(parsed.maxResults, 10);
          if (parsed.qualityFilter) config.qualityFilter = parsed.qualityFilter;
          if (parsed.sortBy) config.sortBy = parsed.sortBy;
        }
      } catch {
        // Ignore invalid base64
      }
    }
  }

  return config;
}

// Generate Manifest JSON for Stremio v4
function getManifest(config?: ScraperConfig, origin?: string, configStr?: string) {
  let name = 'Knaben Magnet Scraper';
  if (config && config.minSeeds && config.minSeeds > 0) {
    name += ` (${config.minSeeds}+ seeds)`;
  }
  if (config && config.qualityFilter && config.qualityFilter !== 'all') {
    name += ` [${config.qualityFilter.toUpperCase()}]`;
  }

  const configurationURL = origin ? (configStr ? `${origin}/${configStr}/configure` : `${origin}/configure`) : undefined;

  return {
    id: 'community.knaben.torrents',
    version: '2.2.1',
    name: name,
    description: 'Trình cào magnet link trực tiếp từ Knaben.org cho Stremio. Sắp xếp torrents theo số lượng Seeds cao nhất.',
    resources: ['stream'],
    types: ['movie', 'series', 'other'],
    idPrefixes: ['tt', 'kna', 'knaben'],
    catalogs: [],
    behaviorHints: {
      configurable: true,
      configurationRequired: false,
      ...(configurationURL ? { configurationURL } : {})
    },
    config: [
      {
        key: 'minSeeds',
        type: 'select',
        title: 'Số Seeds tối thiểu',
        default: '0',
        options: ['0', '5', '10', '20', '50']
      },
      {
        key: 'qualityFilter',
        type: 'select',
        title: 'Bộ lọc chất lượng (Quality)',
        default: 'all',
        options: ['all', '4k', '1080p', '720p']
      },
      {
        key: 'sortBy',
        type: 'select',
        title: 'Sắp xếp kết quả (Sort)',
        default: 'seeds',
        options: ['seeds', 'size', 'title']
      },
      {
        key: 'maxResults',
        type: 'select',
        title: 'Số lượng kết quả tối đa',
        default: '50',
        options: ['20', '50', '100']
      }
    ],
    background: 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?q=80&w=1920',
    logo: 'https://knaben.org/favicon.ico'
  };
}

// Generate rich, self-contained Configure HTML
function getLandingHtml(origin: string, initialConfig: ScraperConfig = {}): string {
  const currentMinSeeds = initialConfig.minSeeds ?? 0;
  const currentQuality = initialConfig.qualityFilter || 'all';
  const currentSortBy = initialConfig.sortBy || 'seeds';
  const currentMaxResults = initialConfig.maxResults || 50;

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cấu hình Knaben Stremio Addon</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: #020617;
      color: #f8fafc;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.5;
      padding: 24px 16px;
    }
    .container { max-width: 860px; margin: 0 auto; display: flex; flex-direction: column; gap: 24px; }
    .header { text-align: center; display: flex; flex-direction: column; gap: 10px; }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 14px;
      border-radius: 9999px;
      background: rgba(168, 85, 247, 0.15);
      border: 1px solid rgba(168, 85, 247, 0.3);
      color: #c084fc;
      font-size: 12px;
      font-weight: 600;
      margin: 0 auto;
    }
    h1 { font-size: 28px; font-weight: 900; color: #fff; }
    .desc { font-size: 14px; color: #94a3b8; max-width: 600px; margin: 0 auto; }
    .card {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .card-title { font-size: 16px; font-weight: 700; color: #f1f5f9; display: flex; align-items: center; gap: 8px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }
    .form-group { display: flex; flex-direction: column; gap: 6px; }
    label { font-size: 13px; font-weight: 600; color: #cbd5e1; }
    select, input[type="text"] {
      background: #020617;
      border: 1px solid #334155;
      color: #f8fafc;
      border-radius: 10px;
      padding: 10px 14px;
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s;
      width: 100%;
    }
    select:focus, input[type="text"]:focus { border-color: #a855f7; }
    .btn-row { display: flex; flex-wrap: wrap; gap: 12px; }
    .btn-primary {
      background: linear-gradient(135deg, #9333ea, #4f46e5);
      color: #fff;
      padding: 12px 24px;
      border-radius: 12px;
      font-weight: 700;
      font-size: 14px;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(147, 51, 234, 0.4);
      flex: 1;
      min-width: 200px;
    }
    .btn-secondary {
      background: #1e293b;
      color: #e2e8f0;
      padding: 12px 20px;
      border-radius: 12px;
      font-weight: 600;
      font-size: 14px;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid #334155;
      cursor: pointer;
    }
    .btn-secondary:hover { background: #334155; }
    .copy-row { display: flex; gap: 8px; }
    .copy-row input { flex: 1; font-family: monospace; font-size: 13px; color: #d8b4fe; }
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #10b981;
      color: #fff;
      padding: 12px 20px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      display: none;
      box-shadow: 0 4px 16px rgba(0,0,0,0.5);
      z-index: 1000;
    }
    footer { text-align: center; font-size: 12px; color: #64748b; padding: 16px 0; border-top: 1px solid #0f172a; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="badge">⚡ Knaben Magnet Scraper Addon • Stremio v4 / v5</div>
      <h1>Cấu hình Knaben Stremio Addon</h1>
      <p class="desc">Tự động cào Magnet link từ Knaben.org, sắp xếp theo số lượng seeds cao nhất và hỗ trợ stream torrent trực tiếp trong Stremio.</p>
    </div>

    <div class="card">
      <div class="card-title">⚙️ Tùy chỉnh bộ lọc Addon</div>
      
      <div class="grid">
        <div class="form-group">
          <label for="minSeedsSelect">Số Seeds tối thiểu:</label>
          <select id="minSeedsSelect" onchange="updateManifestUrl()">
            <option value="0" ${currentMinSeeds === 0 ? 'selected' : ''}>Tất cả (0+ seeds)</option>
            <option value="5" ${currentMinSeeds === 5 ? 'selected' : ''}>Tối thiểu 5 seeds</option>
            <option value="10" ${currentMinSeeds === 10 ? 'selected' : ''}>Tối thiểu 10 seeds</option>
            <option value="20" ${currentMinSeeds === 20 ? 'selected' : ''}>Tối thiểu 20 seeds (Nhanh)</option>
            <option value="50" ${currentMinSeeds === 50 ? 'selected' : ''}>Tối thiểu 50 seeds (Siêu nhanh)</option>
          </select>
        </div>

        <div class="form-group">
          <label for="qualitySelect">Chất lượng video:</label>
          <select id="qualitySelect" onchange="updateManifestUrl()">
            <option value="all" ${currentQuality === 'all' ? 'selected' : ''}>Tất cả chất lượng (All)</option>
            <option value="4k" ${currentQuality === '4k' ? 'selected' : ''}>Chỉ 4K UHD (2160p)</option>
            <option value="1080p" ${currentQuality === '1080p' ? 'selected' : ''}>Chỉ 1080p Full HD</option>
            <option value="720p" ${currentQuality === '720p' ? 'selected' : ''}>Chỉ 720p HD</option>
          </select>
        </div>

        <div class="form-group">
          <label for="sortSelect">Sắp xếp theo:</label>
          <select id="sortSelect" onchange="updateManifestUrl()">
            <option value="seeds" ${currentSortBy === 'seeds' ? 'selected' : ''}>Seeds cao nhất trước</option>
            <option value="size" ${currentSortBy === 'size' ? 'selected' : ''}>Dung lượng lớn nhất</option>
            <option value="title" ${currentSortBy === 'title' ? 'selected' : ''}>Tên tệp (A-Z)</option>
          </select>
        </div>

        <div class="form-group">
          <label for="maxResultsSelect">Số kết quả tối đa:</label>
          <select id="maxResultsSelect" onchange="updateManifestUrl()">
            <option value="20" ${currentMaxResults === 20 ? 'selected' : ''}>20 kết quả</option>
            <option value="50" ${currentMaxResults === 50 ? 'selected' : ''}>50 kết quả (Khuyên dùng)</option>
            <option value="100" ${currentMaxResults === 100 ? 'selected' : ''}>100 kết quả</option>
          </select>
        </div>
      </div>

      <div class="btn-row">
        <a id="stremioInstallBtn" href="#" class="btn-primary">
          <span>🚀 Cài vào Stremio (1-Click Install)</span>
        </a>
        <a id="stremioWebBtn" href="#" target="_blank" class="btn-secondary">
          <span>Mở Stremio Web</span>
        </a>
      </div>

      <div class="form-group">
        <label>Link Manifest cài đặt thủ công (Dán vào ô tìm kiếm Addon trong Stremio):</label>
        <div class="copy-row">
          <input type="text" readonly id="manifestInput" class="select-all" />
          <button type="button" onclick="copyManifestUrl()" class="btn-secondary">Sao chép Link</button>
        </div>
      </div>
    </div>

    <footer>
      Knaben Stremio Addon • Hỗ trợ IMDb & Cinemeta Movie / Series
    </footer>
  </div>

  <div id="copyToast" class="toast">Đã sao chép link Manifest vào bộ nhớ tạm!</div>

  <script>
    const ORIGIN = '${origin}';

    function updateManifestUrl() {
      const minSeedsEl = document.getElementById('minSeedsSelect');
      const qualityEl = document.getElementById('qualitySelect');
      const sortEl = document.getElementById('sortSelect');
      const maxResultsEl = document.getElementById('maxResultsSelect');

      const minSeeds = minSeedsEl ? minSeedsEl.value : '0';
      const quality = qualityEl ? qualityEl.value : 'all';
      const sortBy = sortEl ? sortEl.value : 'seeds';
      const maxResults = maxResultsEl ? maxResultsEl.value : '50';

      const params = new URLSearchParams();
      if (minSeeds !== '0') params.set('minSeeds', minSeeds);
      if (quality !== 'all') params.set('qualityFilter', quality);
      if (sortBy !== 'seeds') params.set('sortBy', sortBy);
      if (maxResults !== '50') params.set('maxResults', maxResults);

      const paramStr = params.toString();
      const manifestUrl = paramStr ? (ORIGIN + '/' + paramStr + '/manifest.json') : (ORIGIN + '/manifest.json');
      const stremioDeepLink = manifestUrl.replace(/^https?:\\/\\//, 'stremio://');
      const stremioWebLink = 'https://web.stremio.com/#/addon/detail?addon=' + encodeURIComponent(manifestUrl);

      const manifestInput = document.getElementById('manifestInput');
      const installBtn = document.getElementById('stremioInstallBtn');
      const webBtn = document.getElementById('stremioWebBtn');

      if (manifestInput) manifestInput.value = manifestUrl;
      if (installBtn) installBtn.href = stremioDeepLink;
      if (webBtn) webBtn.href = stremioWebLink;
    }

    function copyManifestUrl() {
      const input = document.getElementById('manifestInput');
      if (!input) return;
      const text = input.value;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(showToast).catch(fallbackCopy);
      } else {
        fallbackCopy();
      }
    }

    function fallbackCopy() {
      const input = document.getElementById('manifestInput');
      if (!input) return;
      input.select();
      try {
        document.execCommand('copy');
        showToast();
      } catch (e) {
        console.error(e);
      }
    }

    function showToast() {
      const toast = document.getElementById('copyToast');
      if (toast) {
        toast.style.display = 'block';
        setTimeout(() => { toast.style.display = 'none'; }, 2500);
      }
    }

    // Call immediately on script execution and on load
    updateManifestUrl();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', updateManifestUrl);
    }
  </script>
</body>
</html>`;
}

// 0. Configure Routes
app.get(['/configure', '/:config/configure'], (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Security-Policy', 'frame-ancestors *');
  
  const origin = `${req.protocol}://${req.get('host')}`;
  const configStr = req.params.config;
  const config = parseConfig(configStr, req.query);
  return res.send(getLandingHtml(origin, config));
});

// 1. Manifest Routes
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=3600, public');
  const origin = `${req.protocol}://${req.get('host')}`;
  const config = parseConfig(undefined, req.query);
  return res.json(getManifest(config, origin));
});

app.get('/:config/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=3600, public');
  
  const configStr = req.params.config;
  if (['favicon.ico', 'api', 'dist', 'src', 'assets'].includes(configStr)) {
    return res.status(404).json({ error: 'Not found' });
  }

  const origin = `${req.protocol}://${req.get('host')}`;
  const config = parseConfig(configStr, req.query);
  return res.json(getManifest(config, origin, configStr));
});

// 2. Catalog & Meta Safety Routes (Catch-all for Stremio probes)
app.get(['/catalog/*', '/:config/catalog/*'], (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=3600, public');
  return res.json({ metas: [] });
});

app.get(['/meta/*', '/:config/meta/*'], (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=3600, public');
  return res.json({ meta: null });
});

// 2. Stream Handler Routes
app.get('/stream/:type/:id.json', async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return handleStreamRequest(req, res, undefined);
});

app.get('/:config/stream/:type/:id.json', async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return handleStreamRequest(req, res, req.params.config);
});

async function handleStreamRequest(req: express.Request, res: express.Response, configStr?: string) {
  const { type, id } = req.params;
  const config = parseConfig(configStr, req.query);

  try {
    const mediaMeta = await resolveStremioMedia(type, id);
    const searchQuery = mediaMeta.primaryQuery;

    if (!searchQuery || !searchQuery.trim()) {
      return res.json({ streams: [] });
    }

    // Scrape Knaben directly for magnet links
    const torrents = await scrapeKnaben(searchQuery, config, mediaMeta);
    const streams = formatStremioStreams(torrents);

    return res.json({ streams });
  } catch (error) {
    console.error('[Stream Error]', error);
    return res.json({ streams: [] });
  }
}

// 3. REST API for Web UI Direct Knaben Magnet Search
app.get('/api/knaben/search', async (req, res) => {
  const q = ((req.query.q as string) || '').trim();
  if (!q) {
    return res.json({ success: true, count: 0, items: [] });
  }

  const config = parseConfig(undefined, req.query);

  try {
    const mediaMeta = await resolveStremioMedia('other', q);
    const searchQuery = mediaMeta.primaryQuery || q;
    const items = await scrapeKnaben(searchQuery, config, mediaMeta);

    return res.json({
      success: true,
      query: q,
      resolvedQuery: searchQuery,
      count: items.length,
      config,
      items
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: (err as Error).message || 'Lỗi khi cào magnet từ Knaben'
    });
  }
});

// 4. Server Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'Knaben Magnet Scraper',
    version: '2.0.0',
    timestamp: new Date().toISOString()
  });
});

const FILES_TO_PACKAGE = [
  'package.json',
  'tsconfig.json',
  'vite.config.ts',
  'wrangler.toml',
  'server.ts',
  'cloudflare-worker.js',
  'deploy-cloudflare.bat',
  'deploy-cloudflare.sh',
  'start-local-pc.bat',
  'start-local-pc.sh',
  'README.md',
  'index.html',
  'metadata.json',
  'src/worker.ts',
  'src/services/knabenService.ts',
  'src/App.tsx',
  'src/main.tsx',
  'src/index.css'
];

// 5. Source code map for local client ZIP generation
app.get('/api/source-files', (req, res) => {
  try {
    const fileMap: Record<string, string> = {};
    for (const relPath of FILES_TO_PACKAGE) {
      const fullPath = path.resolve(__dirname, relPath);
      if (fs.existsSync(fullPath)) {
        fileMap[relPath] = fs.readFileSync(fullPath, 'utf-8');
      }
    }

    return res.json({ success: true, files: fileMap });
  } catch {
    return res.status(500).json({ success: false, error: 'Failed to read source files' });
  }
});

// 6. Direct Cloudflare Worker standalone code endpoint
app.get('/api/cloudflare-code', (req, res) => {
  try {
    const workerPath = path.resolve(__dirname, 'cloudflare-worker.js');
    if (fs.existsSync(workerPath)) {
      const code = fs.readFileSync(workerPath, 'utf-8');
      return res.json({ success: true, code });
    }
    return res.status(404).json({ success: false, error: 'File cloudflare-worker.js not found' });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to read worker code' });
  }
});

// 7. Direct server-side ZIP download endpoint
app.get('/api/download-pc-zip', async (req, res) => {
  try {
    const zip = new JSZip();
    for (const relPath of FILES_TO_PACKAGE) {
      const fullPath = path.resolve(__dirname, relPath);
      if (fs.existsSync(fullPath)) {
        zip.file(relPath, fs.readFileSync(fullPath, 'utf-8'));
      }
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="knaben-magnet-scraper-pc.zip"');
    res.setHeader('Content-Length', zipBuffer.length.toString());
    return res.send(zipBuffer);
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to generate ZIP download' });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom'
    });
    app.use(vite.middlewares);

    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      try {
        let template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Knaben Magnet Scraper Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
