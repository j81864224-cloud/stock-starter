// worker.js - Cloudflare Worker (paste into a new Worker)
// This proxies Yahoo Finance endpoints to avoid CORS issues for the browser.
// Deploy in Cloudflare Workers (free). The worker exposes:
//  - /quote?symbols=AAPL,MSFT  -> proxies https://query1.finance.yahoo.com/v7/finance/quote
//  - /chart?symbol=AAPL&range=1d -> proxies https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1d
//
// Notes: Yahoo unofficial endpoints can change or rate-limit. Use responsibly.

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Allow OPTIONS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  }

  try {
    if (pathname === '/quote') {
      const symbols = url.searchParams.get('symbols') || '';
      if (!symbols) return new Response(JSON.stringify({error:'symbols required'}), {status:400, headers: {'Content-Type':'application/json'}});
      const yahoo = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=' + encodeURIComponent(symbols);
      const resp = await fetch(yahoo, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept':'application/json' } });
      const text = await resp.text();
      return new Response(text, { status: resp.status, headers: corsJsonHeaders() });
    }

    if (pathname === '/chart') {
      const symbol = url.searchParams.get('symbol');
      const range = url.searchParams.get('range') || '1d';
      if (!symbol) return new Response(JSON.stringify({error:'symbol required'}), {status:400, headers: {'Content-Type':'application/json'}});
      const yahoo = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?range=' + encodeURIComponent(range) + '&interval=5m';
      const resp = await fetch(yahoo, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept':'application/json' } });
      const text = await resp.text();
      return new Response(text, { status: resp.status, headers: corsJsonHeaders() });
    }

    return new Response(JSON.stringify({ok:true}), { headers: corsJsonHeaders() });
  } catch (err) {
    return new Response(JSON.stringify({error: 'fetch failed', detail: err.message}), { status: 500, headers: corsJsonHeaders() });
  }
}

function corsJsonHeaders(){
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS'
  };
}
