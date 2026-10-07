import {
  scrapeKnaben,
  formatStremioStreams,
  resolveStremioMedia,
  fetchCatalogMetas,
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

function getManifest(config?: ScraperConfig, origin?: string, configStr?: string) {
  let name = 'Knaben Torrent Streams';
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
    description: 'Cào và phát trực tiếp magnet torrent từ Knaben.org, sắp xếp theo số lượng seeds cao nhất. Tự động nhận diện phim & tập phim series từ IMDb / Cinemeta.',
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
    logo: 'https://knaben.org/favicon.ico',
  };
}

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
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background-color: #020617; color: #f8fafc; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  </style>
</head>
<body class="min-h-screen flex flex-col justify-between selection:bg-purple-600 selection:text-white">
  <div class="max-w-4xl mx-auto px-4 py-10 w-full space-y-8">
    
    <!-- Header -->
    <div class="text-center space-y-3">
      <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs font-semibold">
        <span>⚡ Cloudflare Workers Serverless</span>
        <span>•</span>
        <span class="text-emerald-400">24/7 Sẵn sàng</span>
        <span>•</span>
        <span class="text-cyan-400">Hỗ trợ IMDb & Cinemeta</span>
      </div>
      <h1 class="text-3xl sm:text-4xl font-black tracking-tight text-white">
        Cấu hình Knaben Stremio Addon
      </h1>
      <p class="text-slate-400 text-sm max-w-xl mx-auto">
        Tự động cào Magnet link từ Knaben.org, sắp xếp theo số lượng seeds cao nhất và hỗ trợ stream torrent mượt mà trên Stremio.
      </p>
    </div>

    <!-- Configuration Box -->
    <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl">
      <div class="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h2 class="text-base sm:text-lg font-bold text-white flex items-center gap-2">
            <span>⚙️ Tùy chỉnh bộ lọc Addon</span>
          </h2>
          <p class="text-xs text-slate-400 mt-0.5">Thay đổi thiết lập bên dưới, link cài đặt sẽ tự động cập nhật ngay lập tức.</p>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <!-- Min seeds -->
        <div class="space-y-1.5">
          <label class="text-xs font-semibold text-slate-300">Số Seeds tối thiểu:</label>
          <select id="minSeedsSelect" onchange="updateManifestUrl()" class="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-2.5 focus:outline-none focus:border-purple-500">
            <option value="0" ${currentMinSeeds === 0 ? 'selected' : ''}>Tất cả (0+ seeds)</option>
            <option value="5" ${currentMinSeeds === 5 ? 'selected' : ''}>Tối thiểu 5 seeds</option>
            <option value="10" ${currentMinSeeds === 10 ? 'selected' : ''}>Tối thiểu 10 seeds</option>
            <option value="20" ${currentMinSeeds === 20 ? 'selected' : ''}>Tối thiểu 20 seeds (Nhanh)</option>
            <option value="50" ${currentMinSeeds === 50 ? 'selected' : ''}>Tối thiểu 50 seeds (Siêu nhanh)</option>
          </select>
        </div>

        <!-- Quality filter -->
        <div class="space-y-1.5">
          <label class="text-xs font-semibold text-slate-300">Chất lượng video:</label>
          <select id="qualitySelect" onchange="updateManifestUrl()" class="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-2.5 focus:outline-none focus:border-purple-500">
            <option value="all" ${currentQuality === 'all' ? 'selected' : ''}>Tất cả chất lượng (All)</option>
            <option value="4k" ${currentQuality === '4k' ? 'selected' : ''}>Chỉ 4K UHD (2160p)</option>
            <option value="1080p" ${currentQuality === '1080p' ? 'selected' : ''}>Chỉ 1080p Full HD</option>
            <option value="720p" ${currentQuality === '720p' ? 'selected' : ''}>Chỉ 720p HD</option>
          </select>
        </div>

        <!-- Sort by -->
        <div class="space-y-1.5">
          <label class="text-xs font-semibold text-slate-300">Sắp xếp theo:</label>
          <select id="sortSelect" onchange="updateManifestUrl()" class="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-2.5 focus:outline-none focus:border-purple-500">
            <option value="seeds" ${currentSortBy === 'seeds' ? 'selected' : ''}>Seeds cao nhất trước</option>
            <option value="size" ${currentSortBy === 'size' ? 'selected' : ''}>Dung lượng file lớn nhất</option>
            <option value="title" ${currentSortBy === 'title' ? 'selected' : ''}>Tên tệp (A-Z)</option>
          </select>
        </div>

        <!-- Max results -->
        <div class="space-y-1.5">
          <label class="text-xs font-semibold text-slate-300">Số kết quả tối đa:</label>
          <select id="maxResultsSelect" onchange="updateManifestUrl()" class="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-2.5 focus:outline-none focus:border-purple-500">
            <option value="20" ${currentMaxResults === 20 ? 'selected' : ''}>20 kết quả</option>
            <option value="50" ${currentMaxResults === 50 ? 'selected' : ''}>50 kết quả (Khuyên dùng)</option>
            <option value="100" ${currentMaxResults === 100 ? 'selected' : ''}>100 kết quả</option>
          </select>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex flex-col sm:flex-row gap-3 pt-2">
        <a id="stremioInstallBtn" href="#" class="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-purple-600/30 transition-all active:scale-95">
          <span>🚀 Cài vào Stremio (1-Click Install)</span>
        </a>
        <a id="stremioWebBtn" href="#" target="_blank" class="inline-flex items-center justify-center gap-2 px-5 py-3.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl font-semibold text-sm transition-all">
          <span>Mở Stremio Web</span>
        </a>
      </div>

      <!-- Manifest URL Copy -->
      <div class="space-y-2 pt-2">
        <label class="text-xs font-semibold text-slate-400">Link Manifest cài đặt thủ công (Dán vào ô tìm kiếm Addon trong Stremio):</label>
        <div class="flex gap-2">
          <input type="text" readonly id="manifestInput" class="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-purple-300 select-all" />
          <button onclick="navigator.clipboard.writeText(document.getElementById('manifestInput').value); alert('Đã sao chép link manifest!')" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold cursor-pointer">
            Copy Link
          </button>
        </div>
      </div>
    </div>

    <!-- Live Test Search Tool -->
    <div class="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
      <h3 class="text-sm font-bold text-slate-200 flex items-center gap-2">
        <span>🔍 Thử nghiệm cào torrent ngay trên trang web</span>
      </h3>
      <p class="text-xs text-slate-400">Nhập từ khóa, tên phim hoặc mã IMDb (vd: <code class="text-purple-300 font-mono">Inception</code>, <code class="text-purple-300 font-mono">tt1375666</code>, <code class="text-purple-300 font-mono">Breaking Bad S01E01</code>) để kiểm tra:</p>
      
      <div class="flex gap-2">
        <input type="text" id="testQueryInput" value="Inception 2010" placeholder="Nhập tên phim hoặc mã IMDb..." class="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-purple-500" />
        <button onclick="runTestSearch()" id="testSearchBtn" class="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold transition-all">
          Tìm Kiếm
        </button>
      </div>

      <div class="flex flex-wrap gap-2 text-xs">
        <span class="text-slate-500">Mẫu thử:</span>
        <button type="button" onclick="setTestQuery('Inception 2010')" class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300">Inception 2010</button>
        <button type="button" onclick="setTestQuery('tt1375666')" class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300">tt1375666</button>
        <button type="button" onclick="setTestQuery('Breaking Bad S01E01')" class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300">Breaking Bad S01E01</button>
        <button type="button" onclick="setTestQuery('tt0903747:1:1')" class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300">tt0903747:1:1</button>
      </div>

      <div id="testResultsBox" class="hidden space-y-2 pt-2 border-t border-slate-800 text-xs">
        <div id="testStatusText" class="text-slate-400 font-mono"></div>
        <div id="testItemsList" class="space-y-2 max-h-72 overflow-y-auto pr-1"></div>
      </div>
    </div>

  </div>

  <footer class="text-center py-6 text-xs text-slate-600 border-t border-slate-900">
    Knaben Stremio Addon • Serverless on Cloudflare Workers Global Edge
  </footer>

  <script>
    const ORIGIN = '${origin}';

    function updateManifestUrl() {
      const minSeeds = document.getElementById('minSeedsSelect').value;
      const quality = document.getElementById('qualitySelect').value;
      const sortBy = document.getElementById('sortSelect').value;
      const maxResults = document.getElementById('maxResultsSelect').value;

      const params = new URLSearchParams();
      if (minSeeds !== '0') params.set('minSeeds', minSeeds);
      if (quality !== 'all') params.set('qualityFilter', quality);
      if (sortBy !== 'seeds') params.set('sortBy', sortBy);
      if (maxResults !== '50') params.set('maxResults', maxResults);

      const paramStr = params.toString();
      const manifestUrl = paramStr ? (ORIGIN + '/' + paramStr + '/manifest.json') : (ORIGIN + '/manifest.json');
      const stremioDeepLink = manifestUrl.replace(/^https?:\\/\\//, 'stremio://');
      const stremioWebLink = 'https://web.stremio.com/#/addon/detail?addon=' + encodeURIComponent(manifestUrl);

      document.getElementById('manifestInput').value = manifestUrl;
      document.getElementById('stremioInstallBtn').href = stremioDeepLink;
      document.getElementById('stremioWebBtn').href = stremioWebLink;
    }

    function setTestQuery(q) {
      document.getElementById('testQueryInput').value = q;
      runTestSearch();
    }

    async function runTestSearch() {
      const q = document.getElementById('testQueryInput').value.trim();
      if (!q) return;

      const btn = document.getElementById('testSearchBtn');
      const box = document.getElementById('testResultsBox');
      const statusText = document.getElementById('testStatusText');
      const list = document.getElementById('testItemsList');

      btn.disabled = true;
      btn.innerText = 'Đang tìm...';
      box.classList.remove('hidden');
      statusText.innerText = 'Đang gửi truy vấn cào magnet...';
      list.innerHTML = '';

      try {
        const minSeeds = document.getElementById('minSeedsSelect').value;
        const quality = document.getElementById('qualitySelect').value;
        const sortBy = document.getElementById('sortSelect').value;
        const maxResults = document.getElementById('maxResultsSelect').value;

        const url = ORIGIN + '/api/knaben/search?q=' + encodeURIComponent(q) +
          '&minSeeds=' + minSeeds + '&qualityFilter=' + quality + '&sortBy=' + sortBy + '&maxResults=' + maxResults;

        const res = await fetch(url);
        const data = await res.json();

        btn.disabled = false;
        btn.innerText = 'Tìm Kiếm';

        if (!data.success) {
          statusText.innerText = 'Lỗi: ' + (data.error || 'Không thể cào dữ liệu');
          return;
        }

        const count = data.items ? data.items.length : 0;
        statusText.innerText = 'Tìm thấy ' + count + ' kết quả (Đã chuyển đổi: ' + (data.resolvedQuery || q) + '):';

        if (count === 0) {
          list.innerHTML = '<div class=\"text-slate-500 py-2\">Không tìm thấy torrent nào phù hợp với bộ lọc.</div>';
          return;
        }

        list.innerHTML = data.items.map(item => \`
          <div class=\"p-3 rounded-lg bg-slate-950 border border-slate-800/80 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2\">
            <div class=\"space-y-1 flex-1\">
              <div class=\"font-semibold text-slate-200 line-clamp-1\">\${item.title}</div>
              <div class=\"flex gap-3 text-[11px] text-slate-400 font-mono\">
                <span class=\"text-emerald-400 font-bold\">🟢 \${item.seeds} seeds</span>
                <span>🔴 \${item.leeches} leeches</span>
                <span>💾 \${item.size}</span>
                <span class=\"text-purple-300\">[\${item.quality || 'HD'}]</span>
              </div>
            </div>
            <button onclick=\"navigator.clipboard.writeText('\${item.magnet}'); alert('Đã sao chép link magnet!')\" class=\"shrink-0 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold\">
              Copy Magnet
            </button>
          </div>
        \`).join('');
      } catch (err) {
        btn.disabled = false;
        btn.innerText = 'Tìm Kiếm';
        statusText.innerText = 'Lỗi kết nối mạng: ' + err.message;
      }
    }

    updateManifestUrl();
  </script>
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

    // 1. Root & Configure endpoints (/, /configure, /:config/configure)
    const isConfigurePath = pathname === '/' || pathname === '' || pathname === '/configure' || pathname.endsWith('/configure');
    if (isConfigurePath) {
      let configStr: string | undefined;
      const configConfigureMatch = pathname.match(/^\/([^/]+)\/configure$/);
      if (configConfigureMatch) {
        configStr = configConfigureMatch[1];
      }
      const initialConfig = parseConfig(configStr, url.searchParams);
      return new Response(getLandingHtml(origin, initialConfig), {
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
        version: '2.2.0',
        timestamp: new Date().toISOString(),
        region: (request as any).cf?.colo || 'Global',
      });
    }

    // 3. Manifest endpoints (/manifest.json or /:config/manifest.json)
    if (pathname === '/manifest.json') {
      const config = parseConfig(undefined, url.searchParams);
      return jsonResponse(getManifest(config, origin));
    }

    const manifestMatch = pathname.match(/^\/([^/]+)\/manifest\.json$/);
    if (manifestMatch) {
      const configStr = manifestMatch[1];
      const config = parseConfig(configStr, url.searchParams);
      return jsonResponse(getManifest(config, origin, configStr));
    }

    // 4. Catalog endpoints (catch-all for Stremio catalog probes)
    if (pathname.includes('/catalog/')) {
      const rootCatalogMatch = pathname.match(/^\/catalog\/([^/]+)\/([^/]+?)(?:\/search=([^/]+))?\.json$/);
      const configCatalogMatch = pathname.match(/^\/([^/]+)\/catalog\/([^/]+)\/([^/]+?)(?:\/search=([^/]+))?\.json$/);

      if (rootCatalogMatch || configCatalogMatch) {
        let type: string;
        let id: string;
        let searchQuery: string | undefined;

        if (configCatalogMatch) {
          type = configCatalogMatch[2];
          id = configCatalogMatch[3];
          searchQuery = configCatalogMatch[4];
        } else {
          type = rootCatalogMatch![1];
          id = rootCatalogMatch![2];
          searchQuery = rootCatalogMatch![3];
        }

        const metas = await fetchCatalogMetas(type, id, searchQuery);
        return jsonResponse({ metas });
      }
      return jsonResponse({ metas: [] });
    }

    // 4b. Meta endpoints (catch-all for Stremio meta requests)
    if (pathname.includes('/meta/')) {
      return jsonResponse({ meta: null });
    }

    // 5. Stream endpoints (/stream/:type/:id.json or /:config/stream/:type/:id.json)
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

    // 6. REST API: Search magnet
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

