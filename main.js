// main.js
// IMPORTANT: Deploy the worker (worker.js) and replace PROXY_URL below with your worker URL.
// Example:
// const PROXY_URL = "https://your-worker.yourname.workers.dev"
const PROXY_URL = "REPLACE_WITH_YOUR_PROXY_URL";

// Built-in watchlist (you can edit or expand)
const WATCHLIST = [
  "AAPL","MSFT","GOOGL","AMZN","NVDA","TSLA","JPM","XOM","V","META",
  "BABA","INTC","NFLX","CRM","PYPL","ADBE","ORCL","CSCO","NKE","DIS"
];

const tbody = document.getElementById('stockBody');
const searchEl = document.getElementById('search');
const sectorFilter = document.getElementById('sectorFilter');
const capFilter = document.getElementById('capFilter');
const priceFilter = document.getElementById('priceFilter');
const changeFilter = document.getElementById('changeFilter');
const volumeFilter = document.getElementById('volumeFilter');
const timeframeEl = document.getElementById('timeframe');
const refreshBtn = document.getElementById('refreshBtn');
const status = document.getElementById('status');
const headers = document.querySelectorAll('thead th');

let stocks = []; // live quote objects
let chartsCache = {}; // symbol -> array of prices for sparkline

function fmtCap(n){
  if(!n) return '';
  if(n>=1e12) return (n/1e12).toFixed(2)+'T';
  if(n>=1e9) return (n/1e9).toFixed(2)+'B';
  if(n>=1e6) return (n/1e6).toFixed(2)+'M';
  return n.toString();
}

function fmtNum(n){
  if(n === undefined || n === null) return '';
  if(Math.abs(n) >= 1e9) return (n/1e9).toFixed(2)+'B';
  if(Math.abs(n) >= 1e6) return (n/1e6).toFixed(2)+'M';
  return n.toLocaleString();
}

function setStatus(msg){
  status.textContent = msg;
}

// render sparkline into a canvas element given an array of numbers
function drawSpark(canvas, data){
  if(!canvas || !data || data.length===0) return;
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const w = canvas.width, h = canvas.height;
  const max = Math.max(...data), min = Math.min(...data);
  const range = (max === min) ? 1 : (max - min);
  ctx.lineWidth = 2 * devicePixelRatio;
  ctx.strokeStyle = data[data.length-1] >= data[0] ? '#30d158' : '#ff6b6b';
  ctx.beginPath();
  data.forEach((v,i)=>{
    const x = (i/(data.length-1))*(w-4*devicePixelRatio) + 2*devicePixelRatio;
    const y = h - ((v - min)/range)*(h-4*devicePixelRatio) - 2*devicePixelRatio;
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.stroke();
}

// Render table rows using current filters/sort
function render(){
  const q = searchEl.value.trim().toLowerCase();
  let filtered = stocks.filter(s => s && s.symbol);
  filtered = filtered.filter(s=>{
    if(q){
      if(!(s.symbol.toLowerCase().includes(q) || (s.shortName && s.shortName.toLowerCase().includes(q)))) return false;
    }
    if(sectorFilter.value && s.sector && sectorFilter.value !== s.sector) return false;
    if(capFilter.value){
      const cap = s.marketCap || 0;
      if(capFilter.value === 'mega' && cap < 200e9) return false;
      if(capFilter.value === 'large' && (cap < 10e9 || cap >= 200e9)) return false;
      if(capFilter.value === 'mid' && (cap < 2e9 || cap >= 10e9)) return false;
      if(capFilter.value === 'small' && cap >= 2e9) return false;
    }
    if(priceFilter.value){
      const p = s.regularMarketPrice || 0;
      if(priceFilter.value==='p1' && p>=20) return false;
      if(priceFilter.value==='p2' && (p<20||p>100)) return false;
      if(priceFilter.value==='p3' && (p<100||p>500)) return false;
      if(priceFilter.value==='p4' && p<=500) return false;
    }
    if(changeFilter.value){
      const ch = (s.regularMarketChangePercent || 0);
      if(changeFilter.value==='c1' && ch >= -5) return false;
      if(changeFilter.value==='c2' && (ch < -5 || ch >= -1)) return false;
      if(changeFilter.value==='c3' && (ch < -1 || ch > 1)) return false;
      if(changeFilter.value==='c4' && (ch <= 1 || ch > 5)) return false;
      if(changeFilter.value==='c5' && ch <= 5) return false;
    }
    if(volumeFilter.value){
      const v = s.regularMarketVolume || 0;
      if(volumeFilter.value==='v1' && v >= 1_000_000) return false;
      if(volumeFilter.value==='v2' && (v < 1_000_000 || v >= 10_000_000)) return false;
      if(volumeFilter.value==='v3' && (v < 10_000_000 || v >= 100_000_000)) return false;
      if(volumeFilter.value==='v4' && v < 100_000_000) return false;
    }
    return true;
  });

  tbody.innerHTML = '';
  filtered.forEach(s=>{
    const tr = document.createElement('tr');
    const ch = s.regularMarketChange !== undefined ? s.regularMarketChange.toFixed(2) : '';
    const chPct = s.regularMarketChangePercent !== undefined ? s.regularMarketChangePercent.toFixed(2) : '';
    const vol = s.regularMarketVolume ? fmtNum(s.regularMarketVolume) : '';
    tr.innerHTML = `
      <td class="small"><strong>${s.symbol}</strong></td>
      <td class="small">${s.shortName || ''}</td>
      <td>${s.regularMarketPrice !== undefined ? s.regularMarketPrice.toFixed(2) : ''}</td>
      <td style="color:${ch>=0? '#7fe39a':'#ff7b7b'}">${ch}</td>
      <td style="color:${chPct>=0? '#7fe39a':'#ff7b7b'}">${chPct}%</td>
      <td>${fmtCap(s.marketCap)}</td>
      <td>${vol}</td>
      <td class="center"><canvas class="spark" data-symbol="${s.symbol}"></canvas></td>
    `;
    tbody.appendChild(tr);
  });

  // draw sparklines (async friendly)
  document.querySelectorAll('canvas.spark').forEach(canvas=>{
    const sym = canvas.dataset.symbol;
    const data = chartsCache[sym];
    if(data && data.length>0){
      drawSpark(canvas, data);
    } else {
      // request chart if not cached
      fetchChartForSymbol(sym).then(arr=>{
        if(arr && arr.length>0) {
          chartsCache[sym] = arr;
          drawSpark(canvas, arr);
        }
      }).catch(()=>{});
    }
  });
}

// Populate sectors dropdown from fetched data
function populateSectors(){
  const sectors = Array.from(new Set(stocks.map(s=>s.sector).filter(Boolean))).sort();
  sectorFilter.innerHTML = '<option value="">All sectors</option>';
  sectors.forEach(sec=>{
    const o = document.createElement('option'); o.value = sec; o.textContent = sec; sectorFilter.appendChild(o);
  });
}

// Proxy helper: quote for many symbols
async function fetchQuotes(symbols){
  if(!PROXY_URL || PROXY_URL.startsWith('REPLACE')) {
    alert('Please deploy the included worker and set PROXY_URL in main.js to its URL.');
    return [];
  }
  setStatus('Fetching quotes...');
  try{
    const resp = await fetch(`${PROXY_URL}/quote?symbols=${encodeURIComponent(symbols.join(','))}`);
    if(!resp.ok) throw new Error('proxy error '+resp.status);
    const j = await resp.json();
    return (j.quoteResponse && j.quoteResponse.result) ? j.quoteResponse.result : [];
  } finally {
    setStatus('');
  }
}

// Chart fetcher: pulls recent close prices for sparkline
async function fetchChartForSymbol(symbol){
  if(chartsCache[symbol]) return chartsCache[symbol];
  if(!PROXY_URL || PROXY_URL.startsWith('REPLACE')) return [];
  const range = timeframeEl.value || '1d';
  // Yahoo chart endpoint: /v8/finance/chart/{symbol}?range=1d&interval=5m
  setStatus(`Fetching chart ${symbol}...`);
  try{
    const url = `${PROXY_URL}/chart?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}`;
    const resp = await fetch(url);
    if(!resp.ok) throw new Error('chart proxy error '+resp.status);
    const j = await resp.json();
    // Path: j.chart.result[0].indicators.adjclose[0].adjclose OR j.chart.result[0].indicators.quote[0].close
    if(!j.chart || !j.chart.result || !j.chart.result[0]) return [];
    const r = j.chart.result[0];
    const prices = (r.indicators && r.indicators.adjclose && r.indicators.adjclose[0] && r.indicators.adjclose[0].adjclose)
      || (r.indicators && r.indicators.quote && r.indicators.quote[0] && r.indicators.quote[0].close)
      || [];
    const filtered = (prices || []).filter(v=>v !== null && v !== undefined);
    // Keep up to 60 points for a clean sparkline
    const tail = filtered.slice(-60);
    chartsCache[symbol] = tail;
    return tail;
  } catch(err){
    console.warn('chart fetch failed', symbol, err);
    return [];
  } finally {
    setStatus('');
  }
}

// Refresh all: fetch quotes then optionally chart cache for visible rows
async function refreshAll(){
  if(!PROXY_URL || PROXY_URL.startsWith('REPLACE')) {
    alert('Please deploy the included worker and set PROXY_URL in main.js to its URL.');
    return;
  }
  setStatus('Refreshing quotes...');
  // batch quotes (Yahoo supports many, but keep in safe batches)
  const batchSize = 10;
  let results = [];
  for(let i=0;i< WATCHLIST.length; i+=batchSize){
    const batch = WATCHLIST.slice(i, i+batchSize);
    const r = await fetchQuotes(batch);
    results = results.concat(r);
  }
  // Map results into our stocks array
  stocks = results.map(r=>({
    symbol: r.symbol,
    shortName: r.shortName,
    regularMarketPrice: r.regularMarketPrice,
    regularMarketChange: r.regularMarketChange,
    regularMarketChangePercent: r.regularMarketChangePercent,
    marketCap: r.marketCap,
    regularMarketVolume: r.regularMarketVolume,
    sector: r.sector || r.industry || '',
  }));
  populateSectors();
  // Preload small charts for visible timeframe for the first 10 symbols (to speed UI)
  const preload = stocks.slice(0, 10).map(s => fetchChartForSymbol(s.symbol));
  try{ await Promise.all(preload); }catch(e){}
  render();
  setStatus('Refreshed ' + stocks.length + ' symbols');
}

// Fetch single chart used by render if missing
async function fetchChartForSymbol(sym){
  return await fetchChartForSymbolOriginal(sym);
}

// Fix name duplication (wrapper) — original impl kept above; rename to avoid hoisting shadow
const fetchChartForSymbolOriginal = (async function(sym){
  if(chartsCache[sym]) return chartsCache[sym];
  return await (async function(sym){ // reuse earlier function body
    if(chartsCache[sym]) return chartsCache[sym];
    if(!PROXY_URL || PROXY_URL.startsWith('REPLACE')) return [];
    const range = timeframeEl.value || '1d';
    setStatus(`Fetching chart ${sym}...`);
    try{
      const url = `${PROXY_URL}/chart?symbol=${encodeURIComponent(sym)}&range=${encodeURIComponent(range)}`;
      const resp = await fetch(url);
      if(!resp.ok) throw new Error('chart proxy error '+resp.status);
      const j = await resp.json();
      if(!j.chart || !j.chart.result || !j.chart.result[0]) return [];
      const r = j.chart.result[0];
      const prices = (r.indicators && r.indicators.adjclose && r.indicators.adjclose[0] && r.indicators.adjclose[0].adjclose)
        || (r.indicators && r.indicators.quote && r.indicators.quote[0] && r.indicators.quote[0].close)
        || [];
      const filtered = (prices || []).filter(v=>v !== null && v !== undefined);
      const tail = filtered.slice(-60);
      chartsCache[sym] = tail;
      return tail;
    } catch(err){
      console.warn('chart fetch failed', sym, err);
      return [];
    } finally {
      setStatus('');
    }
  })(sym);
})();

// Sorting behavior
headers.forEach(h=>{
  h.addEventListener('click', ()=>{
    const key = h.dataset.key;
    if(!key) return;
    stocks.sort((a,b)=>{
      const va = a[key] || 0;
      const vb = b[key] || 0;
      if(typeof va === 'string') return va.localeCompare(vb);
      return vb - va;
    });
    render();
  });
});

// UI events
refreshBtn.addEventListener('click', ()=>{ chartsCache = {}; refreshAll(); });
searchEl.addEventListener('input', render);
sectorFilter.addEventListener('change', render);
capFilter.addEventListener('change', render);
priceFilter.addEventListener('change', render);
changeFilter.addEventListener('change', render);
volumeFilter.addEventListener('change', render);
timeframeEl.addEventListener('change', ()=>{
  chartsCache = {}; // clear chart cache so new timeframe is fetched
  // prefetch for visible items
  (stocks.slice(0,10).forEach(s=>fetchChartForSymbolOriginal(s.symbol)));
  render();
});

// initial boot: quick empty render and then full refresh
render();
setStatus('Ready — click Refresh to load live data.');
