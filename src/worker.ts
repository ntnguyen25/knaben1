import {
  scrapeKnaben,
  formatStremioStreams,
  resolveStremioMedia,
  ScraperConfig,
  TorrentItem
} from './services/knabenService';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function parseConfig(configStr?: string, searchParams?: URLSearchParams): ScraperConfig {
  const config: ScraperConfig = {
    minSeeds: searchParams?.get('minSeeds') ? parseInt(searchParams.get('minSeeds')!, 10) : 0,
    maxResults: searchParams?.get('maxResults') ? parseInt(searchParams.get('maxResults')!, 10) : 50,
    qualityFilter: searchParams?.get('qualityFilter') || 'all',
    sortBy: (searchParams?.get('sortBy') as any) || 'seeds',
  };

  if (configStr && configStr !== 'manifest.json') {
    if (configStr.includes('=')) {
      const params = new URLSearchParams(configStr);
      if (params.has('minSeeds')) config.minSeeds = parseInt(params.get('minSeeds')!, 10);
      if (params.has('maxResults')) config.maxResults = parseInt(params.get('maxResults')!, 10);
      if (params.has('qualityFilter')) config.qualityFilter = params.get('qualityFilter')!;
      if (params.has('sortBy')) config.sortBy = params.get('sortBy') as any;
    } else {
      try {
        const jsonStr = atob(configStr);
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

function getManifest(config?: ScraperConfig) {
  let name = 'Knaben Magnet Scraper (Cloudflare)';
  if (config && config.minSeeds && config.minSeeds > 0) {
    name += ` (${config.minSeeds}+ seeds)`;
  }

  return {
    id: 'com.knaben.magnet.scraper.cf',
    version: '2.1.0',
    name: name,
    description: 'Trình cào magnet link trực tiếp từ Knaben.org cho Stremio chạy trên Cloudflare Workers. Tốc độ cao 24/7, sắp xếp seeds cao nhất.',
    resources: ['stream'],
    types: ['movie', 'series', 'other'],
    idPrefixes: ['kna', 'knaben', 'tt'],
    behaviorHints: {
      configurable: true,
    },
    background: 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?q=80&w=1920',
    logo: 'https://knaben.org/favicon.ico',
  };
}

function getLandingHtml(origin: string, manifestUrl: string, stremioDeepLink: string): string {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Knaben Stremio Addon - Cloudflare Worker Edition</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background-color: #020617; color: #f8fafc; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  </style>
</head>
<body class="min-h-screen flex flex-col justify-between selection:bg-purple-600 selection:text-white">
  <div class="max-w-4xl mx-auto px-4 py-12 w-full space-y-8">
    
    <div class="text-center space-y-3">
      <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs font-semibold">
        <span>⚡ Cloudflare Workers Serverless</span>
        <span>•</span>
        <span class="text-emerald-400">24/7 Online</span>
      </div>
      <h1 class="text-3xl sm:text-4xl font-black tracking-tight text-white">
        Knaben Stremio Addon
      </h1>
      <p class="text-slate-400 text-sm max-w-xl mx-auto">
        Addon cào magnet link tự động từ Knaben.org, sắp xếp theo số lượng seeds cao nhất và hỗ trợ stream mượt mà trên Stremio.
      </p>
    </div>

    <!-- Quick Install Card -->
    <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl">
      <div class="flex flex-col sm:flex-row gap-3">
        <a href="${stremioDeepLink}" class="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-purple-600/30 transition-all active:scale-95">
          <span>🚀 Cài vào Stremio (1-Click)</span>
        </a>
        <a href="https://web.stremio.com/#/addon/detail?addon=${encodeURIComponent(manifestUrl)}" target="_blank" class="inline-flex items-center justify-center gap-2 px-5 py-3.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl font-semibold text-sm transition-all">
          <span>Mở Stremio Web</span>
        </a>
      </div>

      <div class="space-y-2">
        <label class="text-xs font-semibold text-slate-400">Link Manifest cài thủ công (Copy & Paste vào Stremio Addons search):</label>
        <div class="flex gap-2">
          <input type="text" readonly value="${manifestUrl}" id="manifestInput" class="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-purple-300 select-all" />
          <button onclick="navigator.clipboard.writeText(document.getElementById('manifestInput').value); alert('Đã sao chép link manifest!')" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold">
            Copy Link
          </button>
        </div>
      </div>
    </div>

    <!-- Endpoint Overview -->
    <div class="bg-slate-900/60 border border-slate-800/80 rounded-xl p-5 space-y-3 text-xs">
      <h3 class="font-bold text-slate-200 text-sm">📡 Các endpoint API khả dụng:</h3>
      <ul class="space-y-1.5 font-mono text-slate-400">
        <li><strong class="text-purple-400">GET /manifest.json</strong> - Manifest chuẩn Stremio v4</li>
        <li><strong class="text-purple-400">GET /stream/:type/:id.json</strong> - Trả về streams torrent magnet cho phim/tập</li>
        <li><strong class="text-purple-400">GET /api/knaben/search?q=Inception</strong> - REST API tìm kiếm magnet trực tiếp</li>
        <li><strong class="text-purple-400">GET /api/health</strong> - Kiểm tra trạng thái máy chủ worker</li>
      </ul>
    </div>

  </div>

  <footer class="text-center py-6 text-xs text-slate-600 border-t border-slate-900">
    Knaben Stremio Addon • Hosted on Cloudflare Workers Global Edge Network
  </footer>
</body>
</html>`;
}

export default {
  async fetch(request: Request): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;
    const origin = url.origin;

    // 1. Root landing page
    if (pathname === '/' || pathname === '') {
      const manifestUrl = `${origin}/manifest.json`;
      const stremioDeepLink = `stremio://${url.host}/manifest.json`;
      return new Response(getLandingHtml(origin, manifestUrl, stremioDeepLink), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          ...CORS_HEADERS,
        },
      });
    }

    // 2. Health check
    if (pathname === '/api/health') {
      return jsonResponse({
        status: 'online',
        service: 'Knaben Stremio Addon (Cloudflare Worker)',
        version: '2.1.0',
        timestamp: new Date().toISOString(),
        region: (request as any).cf?.colo || 'Global',
      });
    }

    // 3. Manifest endpoints (/manifest.json or /:config/manifest.json)
    if (pathname === '/manifest.json') {
      const config = parseConfig(undefined, url.searchParams);
      return jsonResponse(getManifest(config));
    }

    const manifestMatch = pathname.match(/^\/([^/]+)\/manifest\.json$/);
    if (manifestMatch) {
      const configStr = manifestMatch[1];
      const config = parseConfig(configStr, url.searchParams);
      return jsonResponse(getManifest(config));
    }

    // 4. Stream endpoints (/stream/:type/:id.json or /:config/stream/:type/:id.json)
    const rootStreamMatch = pathname.match(/^\/stream\/([^/]+)\/([^/]+)\.json$/);
    const configStreamMatch = pathname.match(/^\/([^/]+)\/stream\/([^/]+)\/([^/]+)\.json$/);

    if (rootStreamMatch || configStreamMatch) {
      let configStr: string | undefined;
      let type: string;
      let id: string;

      if (configStreamMatch) {
        configStr = configStreamMatch[1];
        type = configStreamMatch[2];
        id = configStreamMatch[3];
      } else {
        type = rootStreamMatch![1];
        id = rootStreamMatch![2];
      }

      const config = parseConfig(configStr, url.searchParams);

      try {
        const mediaMeta = await resolveStremioMedia(type, id);
        const searchQuery = mediaMeta.primaryQuery;

        if (!searchQuery || !searchQuery.trim()) {
          return jsonResponse({ streams: [] });
        }

        const torrents = await scrapeKnaben(searchQuery, config, mediaMeta);
        const streams = formatStremioStreams(torrents);

        return jsonResponse({ streams });
      } catch (err) {
        return jsonResponse({ streams: [] });
      }
    }

    // 5. REST API: Search magnet
    if (pathname === '/api/knaben/search') {
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) {
        return jsonResponse({ success: true, count: 0, items: [] });
      }

      const config = parseConfig(undefined, url.searchParams);
      try {
        const mediaMeta = await resolveStremioMedia('other', q);
        const searchQuery = mediaMeta.primaryQuery || q;
        const items = await scrapeKnaben(searchQuery, config, mediaMeta);
        return jsonResponse({
          success: true,
          query: q,
          resolvedQuery: searchQuery,
          count: items.length,
          config,
          items,
        });
      } catch (err) {
        return jsonResponse(
          {
            success: false,
            error: (err as Error).message || 'Lỗi khi cào magnet từ Knaben',
          },
          500
        );
      }
    }

    // 404 fallback
    return jsonResponse({ error: 'Not found' }, 404);
  },
};
