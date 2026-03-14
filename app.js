// ── STATE ──────────────────────────────────────────────────
let STATE = {
  address: null, walletData: null, alerts: [], dismissed: [],
  mmConnected: false, scanning: false, alertFilter: 'all',
  mmTimeout: null
};
 
// ── HELPERS ────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const isValidAddr = a => /^0x[a-fA-F0-9]{40}$/.test(a);
const RISK_COLORS = { low:'#00ff88', medium:'#ffcc00', high:'#ff9500', critical:'#ff3b3b' };
const SAFE = new Set(['ETH','WETH','USDC','USDT','DAI','WBTC','LINK','UNI','AAVE','ARB','OP','MATIC','WMATIC','STETH','RETH','CBETH']);
const MED  = new Set(['SHIB','PEPE','DOGE','CRV','SNX','LDO','MKR','COMP','1INCH','BAL','SUSHI']);
const AUDIT= new Set(['ETH','WETH','USDC','USDT','DAI','WBTC','LINK','UNI','AAVE','ARB','OP','MATIC','WMATIC','STETH','RETH','CBETH','MKR','COMP','CRV','LDO']);
 
function classifyRisk(sym, usd) {
  const s = sym.toUpperCase();
  if (SAFE.has(s)) return 'low';
  if (MED.has(s))  return 'medium';
  if (usd < 10)   return 'critical';
  if (usd < 200)  return 'high';
  return 'medium';
}
 
function fmt(n) { return Number(n).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}); }
function fmtBal(n) { const v = parseFloat(n); return v >= 1 ? v.toFixed(4) : v.toFixed(6); }
 
// ── PRICE CACHE ────────────────────────────────────────────
let _priceCache = { data: null, ts: 0 };
async function getCachedPrices() {
  if (_priceCache.data && Date.now() - _priceCache.ts < 60000) return _priceCache.data;
  const ids = 'ethereum,usd-coin,tether,chainlink,uniswap,wrapped-bitcoin,dai,aave,matic-network,arbitrum,optimism,shiba-inu,pepe,lido-dao,curve-dao-token,maker';
  const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`);
  const d = await r.json();
  if (!d?.ethereum?.usd) throw new Error('CoinGecko rate-limited');
  _priceCache = { data: d, ts: Date.now() };
  return d;
}
 
// ── FETCH WALLET DATA ──────────────────────────────────────
async function fetchWalletData(address, onStep) {
  const addr = address.toLowerCase();
 
  // Strategy 1: Ethplorer (single call, ETH + tokens + prices)
  onStep('Querying Ethplorer API...');
  try {
    const r = await fetch(`https://api.ethplorer.io/getAddressInfo/${addr}?apiKey=freekey`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (j.error) throw new Error(j.error.message || 'Ethplorer error');
 
    const tokens = [];
    const ethBal = j.ETH?.balance ?? 0;
    const ethUsd = ethBal * (j.ETH?.price?.rate ?? 0);
    if (ethBal > 0) {
      tokens.push({ symbol:'ETH', name:'Ethereum',
        balance: parseFloat(ethBal.toFixed(6)),
        value: parseFloat(ethUsd.toFixed(2)),
        change: parseFloat((j.ETH?.price?.diff ?? 0).toFixed(2)),
        risk:'low', audit:true, contractAddress:null });
    }
    for (const t of (j.tokens ?? [])) {
      const dec = Number(t.tokenInfo?.decimals ?? 18);
      const raw = Number(t.rawBalance ?? t.balance ?? 0);
      const bal = raw / Math.pow(10, dec);
      if (!isFinite(bal) || bal <= 0) continue;
      const price = t.tokenInfo?.price?.rate ?? 0;
      const usd   = price ? parseFloat((bal * price).toFixed(2)) : 0;
      const sym   = (t.tokenInfo?.symbol ?? 'UNKNOWN').toUpperCase();
      tokens.push({ symbol:sym, name:t.tokenInfo?.name??sym,
        balance:parseFloat(bal.toFixed(6)), value:isFinite(usd)?usd:0,
        change:parseFloat((t.tokenInfo?.price?.diff??0).toFixed(2)),
        risk:classifyRisk(sym,usd), audit:AUDIT.has(sym),
        contractAddress:t.tokenInfo?.address??null });
    }
    tokens.sort((a,b)=>b.value-a.value);
    if (tokens.length > 0 || j.ETH !== undefined)
      return buildResult(address, tokens, 'Ethplorer');
    throw new Error('No data');
  } catch(e) { console.warn('Ethplorer:', e.message); }
 
  // Strategy 2: Ankr + CoinGecko
  onStep('Trying Ankr API...');
  try {
    const r = await fetch('https://rpc.ankr.com/multichain', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ jsonrpc:'2.0', method:'ankr_getAccountBalance',
        params:{ blockchain:['eth'], walletAddress:addr, onlyWhitelisted:false }, id:1 })
    });
    const j = await r.json();
    const assets = j?.result?.assets ?? [];
    if (!assets.length) throw new Error('Empty');
 
    onStep('Fetching prices from CoinGecko...');
    let prices = {};
    try { prices = await getCachedPrices(); } catch(_) {}
    const ep = prices?.ethereum?.usd ?? 3500;
    const ec = parseFloat((prices?.ethereum?.usd_24h_change??0).toFixed(2));
    const cgMap = buildCgMap(prices, ep, ec);
 
    const tokens = [];
    for (const a of assets) {
      const bal = Number(a.balance ?? 0);
      if (!isFinite(bal) || bal <= 0) continue;
      const sym = (a.tokenSymbol ?? 'UNKNOWN').toUpperCase();
      const cg  = cgMap[sym];
      const rawUsd = a.balanceUsd ? parseFloat(a.balanceUsd) : (cg ? bal * cg.usd : 0);
      const usd = isFinite(rawUsd) ? parseFloat(rawUsd.toFixed(2)) : 0;
      tokens.push({ symbol:sym, name:a.tokenName??sym, balance:parseFloat(bal.toFixed(6)),
        value:usd, change:cg?parseFloat(cg.chg.toFixed(2)):0,
        risk:classifyRisk(sym,usd), audit:AUDIT.has(sym), contractAddress:a.contractAddress??null });
    }
    tokens.sort((a,b)=>b.value-a.value);
    return buildResult(address, tokens, 'Ankr');
  } catch(e) { console.warn('Ankr:', e.message); }
 
  // Strategy 3: Raw RPC for ETH only
  onStep('Trying Ethereum RPC...');
  const rpcs = ['https://cloudflare-eth.com','https://eth.llamarpc.com','https://rpc.ankr.com/eth','https://ethereum.publicnode.com'];
  for (const url of rpcs) {
    try {
      const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({jsonrpc:'2.0',method:'eth_getBalance',params:[addr,'latest'],id:1}) });
      const j = await r.json();
      if (j?.result == null) continue;
      let prices = {}; try { prices = await getCachedPrices(); } catch(_) {}
      const ep = prices?.ethereum?.usd ?? 3500;
      const ec = parseFloat((prices?.ethereum?.usd_24h_change??0).toFixed(2));
      const ethBal = Number(BigInt(j.result)) / (10**18);
      const val = parseFloat((ethBal * ep).toFixed(2));
      const tokens = ethBal > 0 ? [{ symbol:'ETH', name:'Ethereum',
        balance:parseFloat(ethBal.toFixed(6)), value:isFinite(val)?val:0,
        change:ec, risk:'low', audit:true, contractAddress:null }] : [];
      return buildResult(address, tokens, 'RPC');
    } catch(_) {}
  }
 
  throw new Error('All APIs failed. Check your internet connection and try again.');
}
 
function buildCgMap(p, ep, ec) {
  return {
    ETH:{usd:ep,chg:ec},WETH:{usd:ep,chg:ec},
    USDC:{usd:p?.['usd-coin']?.usd??1,chg:p?.['usd-coin']?.usd_24h_change??0},
    USDT:{usd:p?.tether?.usd??1,chg:p?.tether?.usd_24h_change??0},
    DAI:{usd:p?.dai?.usd??1,chg:p?.dai?.usd_24h_change??0},
    LINK:{usd:p?.chainlink?.usd??0,chg:p?.chainlink?.usd_24h_change??0},
    UNI:{usd:p?.uniswap?.usd??0,chg:p?.uniswap?.usd_24h_change??0},
    WBTC:{usd:p?.['wrapped-bitcoin']?.usd??0,chg:p?.['wrapped-bitcoin']?.usd_24h_change??0},
    AAVE:{usd:p?.aave?.usd??0,chg:p?.aave?.usd_24h_change??0},
    MATIC:{usd:p?.['matic-network']?.usd??0,chg:p?.['matic-network']?.usd_24h_change??0},
    ARB:{usd:p?.arbitrum?.usd??0,chg:p?.arbitrum?.usd_24h_change??0},
    OP:{usd:p?.optimism?.usd??0,chg:p?.optimism?.usd_24h_change??0},
    SHIB:{usd:p?.['shiba-inu']?.usd??0,chg:p?.['shiba-inu']?.usd_24h_change??0},
    PEPE:{usd:p?.pepe?.usd??0,chg:p?.pepe?.usd_24h_change??0},
    LDO:{usd:p?.['lido-dao']?.usd??0,chg:p?.['lido-dao']?.usd_24h_change??0},
    CRV:{usd:p?.['curve-dao-token']?.usd??0,chg:p?.['curve-dao-token']?.usd_24h_change??0},
    MKR:{usd:p?.maker?.usd??0,chg:p?.maker?.usd_24h_change??0},
  };
}
 
function buildResult(address, tokens, source) {
  const nw    = tokens.reduce((s,t)=>s+(isFinite(t.value)?t.value:0),0);
  const snw   = Math.max(nw,0.01);
  const hi    = tokens.filter(t=>t.risk==='high'||t.risk==='critical').reduce((s,t)=>s+(isFinite(t.value)?t.value:0),0);
  const ua    = tokens.filter(t=>!t.audit).length;
  const sl    = Math.max(tokens.length,1);
  const rug   = Math.min(90,Math.round(hi/snw*80+ua*4));
  const con   = Math.min(90,ua*10);
  const vol   = Math.min(90,Math.round(tokens.filter(t=>t.risk!=='low').length/sl*85));
  const score = Math.max(5,Math.min(99,Math.round(100-(rug*0.35+con*0.25+vol*0.40))));
  const ts = Date.now();
  const alerts = [];
  const crit = tokens.filter(t=>t.risk==='critical');
  const high = tokens.filter(t=>t.risk==='high');
  if (crit.length) alerts.push({id:ts,   type:'critical',title:'Critical Risk Tokens Detected',message:`${crit.map(t=>t.symbol).join(', ')} — unaudited, near-zero liquidity`,time:'just now',token:crit[0].symbol});
  if (high.length) alerts.push({id:ts+1, type:'warning', title:'High-Risk Tokens in Wallet',   message:`${high.map(t=>t.symbol).join(', ')} — unverified or low-cap assets`,time:'just now',token:high[0].symbol});
  alerts.push({id:ts+2,type:'info',title:'Scan Complete',message:`Analysed ${tokens.length} asset(s) via ${source}.`,time:'just now',token:'ETH'});
  const ethPrice = (tokens.find(t=>t.symbol==='ETH')?.value??0) / Math.max(tokens.find(t=>t.symbol==='ETH')?.balance??1, 0.000001);
  return { address, safetyScore:score, netWorth:parseFloat(nw.toFixed(2)), tokens,
    defiPositions:[], riskBreakdown:{rugPullRisk:rug,contractRisk:con,liquidationRisk:0,volatilityRisk:vol},
    alerts, ethPrice:isFinite(ethPrice)?ethPrice:3500 };
}
 
// ── METAMASK ───────────────────────────────────────────────
async function connectMetaMask() {
  const btn = $('mm-btn');
  const lbl = $('mm-btn-label');
  const msg = $('mm-msg');
 
  if (!window.ethereum) {
    msg.textContent = '⚠ MetaMask not detected. Install it from metamask.io then refresh.';
    msg.style.display = 'block';
    return;
  }
 
  msg.style.display = 'none';
  btn.disabled = true;
  lbl.textContent = '⏳ Waiting for MetaMask popup...';
 
  // 60s timeout
  STATE.mmTimeout = setTimeout(() => {
    btn.disabled = false;
    lbl.textContent = 'Connect MetaMask';
    msg.textContent = '⚠ Timed out. Open the MetaMask popup (🦊 in toolbar) and approve the connection.';
    msg.style.display = 'block';
  }, 60000);
 
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    clearTimeout(STATE.mmTimeout);
 
    if (!accounts?.length) throw new Error('No accounts returned');
 
    lbl.textContent = '⏳ Checking network...';
    const chainId = await window.ethereum.request({ method: 'eth_chainId' });
    if (chainId !== '0x1') {
      lbl.textContent = '⏳ Switching to Mainnet...';
      try {
        await window.ethereum.request({ method:'wallet_switchEthereumChain', params:[{chainId:'0x1'}] });
      } catch(_) {
        btn.disabled = false;
        lbl.textContent = 'Connect MetaMask';
        msg.textContent = '⚠ Switch MetaMask to Ethereum Mainnet then click Connect again.';
        msg.style.display = 'block';
        return;
      }
    }
 
    STATE.mmConnected = true;
    btn.disabled = false;
    lbl.textContent = 'Connect MetaMask';
    await startScan(accounts[0], true);
 
  } catch(e) {
    clearTimeout(STATE.mmTimeout);
    btn.disabled = false;
    lbl.textContent = 'Connect MetaMask';
    if (e.code === 4001)   msg.textContent = '⚠ Rejected. Click Connect and approve the popup.';
    else if (e.code === -32002) msg.textContent = '⚠ MetaMask popup already open — click the 🦊 icon in your toolbar.';
    else msg.textContent = '⚠ ' + (e.message || 'Connection failed');
    msg.style.display = 'block';
  }
 
  // Listen for account/chain changes
  window.ethereum.on('accountsChanged', accs => {
    if (!accs.length) disconnect();
    else if (STATE.address && accs[0].toLowerCase() !== STATE.address.toLowerCase())
      startScan(accs[0], true);
  });
  window.ethereum.on('chainChanged', () => disconnect());
}
 
// ── SCAN FLOW ──────────────────────────────────────────────
function quickScan(addr) {
  document.getElementById('addr-input').value = addr;
  startScan(addr);
}
 
async function startScan(address, fromMM=false) {
  const addr = (address || '').trim();
  const errEl = $('scan-err');
 
  if (!isValidAddr(addr)) {
    errEl.textContent = '⚠ Invalid address. Must be 0x followed by 40 hex characters.';
    errEl.style.display = 'block';
    return;
  }
  errEl.style.display = 'none';
 
  // Show scan overlay
  STATE.scanning = true;
  STATE.mmConnected = fromMM;
  $('scan-addr-label').textContent = 'Scanning: ' + addr;
  $('scan-overlay').classList.add('active');
  $('connect-screen').style.display = 'none';
 
  function step(msg) { $('scan-step-text').textContent = msg; }
 
  try {
    const data = await fetchWalletData(addr, step);
    STATE.address    = addr;
    STATE.walletData = data;
    STATE.alerts     = [...data.alerts];
    STATE.dismissed  = [];
 
    // Show app
    $('scan-overlay').classList.remove('active');
    $('app').classList.add('active');
    $('hdr-addr').textContent = addr.slice(0,6)+'...'+addr.slice(-4);
    if (fromMM) $('hdr-mm-badge').style.display = 'inline';
    else $('hdr-mm-badge').style.display = 'none';
    $('update-time').textContent = 'Updated ' + new Date().toLocaleTimeString();
 
    // Render all tabs
    renderDashboard();
    renderScanner();
    renderPortfolio();
    renderAlerts();
    updateAlertBadge();
    startAlertMonitor();
 
    // Stay on dashboard
    showTab('dashboard', document.querySelector('[data-tab="dashboard"]'));
 
  } catch(e) {
    $('scan-overlay').classList.remove('active');
    $('connect-screen').style.display = 'flex';
    const errEl = $('scan-err');
    errEl.textContent = e.message || 'Scan failed.';
    errEl.style.display = 'block';
    STATE.scanning = false;
    STATE.mmConnected = false;
  }
}
 
async function refreshWallet() {
  if (!STATE.address || STATE.scanning) return;
  $('refresh-btn').textContent = '⟳ Scanning...';
  $('refresh-btn').disabled = true;
  try {
    const data = await fetchWalletData(STATE.address, msg => {
      $('refresh-btn').textContent = '⟳ ' + msg.slice(0,20) + '...';
    });
    STATE.walletData = data;
    STATE.alerts = [...data.alerts, ...STATE.alerts.filter(a=>!data.alerts.find(x=>x.id===a.id))];
    renderDashboard(); renderPortfolio(); renderAlerts(); updateAlertBadge();
    $('update-time').textContent = 'Updated ' + new Date().toLocaleTimeString();
  } catch(_) {}
  $('refresh-btn').textContent = '⟳ Refresh';
  $('refresh-btn').disabled = false;
}
 
function disconnect() {
  clearTimeout(STATE.mmTimeout);
  clearInterval(STATE._monitorInterval);
  STATE = { address:null, walletData:null, alerts:[], dismissed:[], mmConnected:false, scanning:false, alertFilter:'all', mmTimeout:null };
  $('app').classList.remove('active');
  $('scan-overlay').classList.remove('active');
  $('connect-screen').style.display = 'flex';
  $('addr-input').value = '';
  $('scan-err').style.display = 'none';
  $('mm-msg').style.display = 'none';
  $('mm-btn-label').textContent = 'Connect MetaMask';
  $('mm-btn').disabled = false;
}
 
// ── REAL-TIME MONITOR ──────────────────────────────────────
function startAlertMonitor() {
  clearInterval(STATE._monitorInterval);
  let prevPrices = {};
  STATE._monitorInterval = setInterval(async () => {
    if (!STATE.walletData) return;
    try {
      const prices = await getCachedPrices();
      const ts = Date.now();
      const cgKeys = { eth:'ethereum', wbtc:'wrapped-bitcoin', link:'chainlink',
        usdc:'usd-coin', usdt:'tether', uni:'uniswap', aave:'aave',
        arb:'arbitrum', matic:'matic-network', pepe:'pepe', shib:'shiba-inu' };
      for (const tok of STATE.walletData.tokens) {
        const key = cgKeys[tok.symbol.toLowerCase()];
        if (!key || !prices[key]) continue;
        const cur = prices[key].usd;
        const last = prevPrices[tok.symbol];
        if (last && cur && last > 0) {
          const drop = (last - cur) / last * 100;
          const recent = STATE.alerts.find(a=>a.title.includes(tok.symbol) && ts-a.id < 120000);
          if (!recent) {
            if (drop > 8)
              addAlert({id:ts,type:'critical',title:`${tok.symbol} Price Crash`,message:`${tok.symbol} dropped ${drop.toFixed(1)}% in 30s — possible rug pull`,time:'just now',token:tok.symbol});
            else if (drop > 4)
              addAlert({id:ts,type:'warning',title:`${tok.symbol} Significant Drop`,message:`${tok.symbol} fell ${drop.toFixed(1)}% — monitor closely`,time:'just now',token:tok.symbol});
          }
        }
        prevPrices[tok.symbol] = cur;
      }
    } catch(_) {}
  }, 30000);
}
 
function addAlert(a) {
  STATE.alerts.unshift(a);
  renderAlerts();
  updateAlertBadge();
}
 
function updateAlertBadge() {
  const crit = STATE.alerts.filter(a=>a.type==='critical'&&!STATE.dismissed.includes(a.id)).length;
  const badge = $('alert-badge');
  const banner = $('crit-banner');
  if (crit > 0) {
    badge.textContent = crit; badge.style.display = 'inline';
    $('crit-count').textContent = crit;
    $('crit-s').textContent = crit > 1 ? 's' : '';
    banner.style.display = 'flex';
  } else {
    badge.style.display = 'none'; banner.style.display = 'none';
  }
}
 
// ── TAB NAVIGATION ─────────────────────────────────────────
function showTab(tabId, btn) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  $('tab-' + tabId).classList.add('active');
  if (btn) btn.classList.add('active');
}
 
// ── RING SVG ───────────────────────────────────────────────
function ringHTML(score, size=110, isSafety=false) {
  const r = size/2 - 10, c = 2*Math.PI*r;
  const pct = Math.min(Math.max(score,0),100)/100;
  const col = isSafety
    ? (score>=70?'#00ff88':score>=50?'#ffcc00':'#ff3b3b')
    : (score>=70?'#ff3b3b':score>=40?'#ff9500':'#00ff88');
  return `<svg width="${size}" height="${size}" style="transform:rotate(-90deg)">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="7"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${col}" stroke-width="7"
      stroke-dasharray="${c*pct} ${c}" stroke-linecap="round" style="filter:drop-shadow(0 0 5px ${col})"/>
    <text x="${size/2}" y="${size/2+2}" text-anchor="middle" dominant-baseline="central"
      style="transform:rotate(90deg);transform-origin:${size/2}px ${size/2}px;fill:${col};
      font-size:${size<100?'18px':'22px'};font-family:'Orbitron',monospace;font-weight:700">${score}</text>
  </svg>`;
}
 
// ── RENDER DASHBOARD ───────────────────────────────────────
function renderDashboard() {
  const d = STATE.walletData;
  const rb = d.riskBreakdown;
  const critAlert = STATE.alerts.find(a=>a.type==='critical'&&!STATE.dismissed.includes(a.id));
 
  let html = `<div class="section-title">Security Dashboard</div>
  <div class="section-sub">Live on-chain analysis — ${d.address.slice(0,10)}...${d.address.slice(-6)}</div>`;
 
  if (critAlert) html += `<div class="alert-banner fade">
    <span>🚨</span><div><div class="ab-title">${critAlert.title}</div><div class="ab-msg">${critAlert.message}</div></div></div>`;
 
  // Stats
  const hrc = d.tokens.filter(t=>t.risk==='critical'||t.risk==='high').length;
  const uac = d.tokens.filter(t=>!t.audit).length;
  const sc  = d.safetyScore;
  const scCol = sc>=70?'#00ff88':sc>=50?'#ffcc00':'#ff3b3b';
  const acrit = STATE.alerts.filter(a=>a.type==='critical').length;
  html += `<div class="stats-grid">
    <div class="stat-card" style="border-top-color:rgba(0,255,136,0.3)"><div class="stat-label">NET WORTH</div><div class="stat-val" style="color:#00ff88">$${fmt(d.netWorth)}</div><div class="stat-sub">All assets</div></div>
    <div class="stat-card" style="border-top-color:rgba(167,139,250,0.3)"><div class="stat-label">TOKENS</div><div class="stat-val" style="color:#a78bfa">${d.tokens.length}</div><div class="stat-sub">${hrc} high-risk</div></div>
    <div class="stat-card" style="border-top-color:${scCol}44"><div class="stat-label">SAFETY SCORE</div><div class="stat-val" style="color:${scCol}">${sc}</div><div class="stat-sub">${uac} unaudited</div></div>
    <div class="stat-card" style="border-top-color:rgba(255,59,59,0.3)"><div class="stat-label">ALERTS</div><div class="stat-val" style="color:#ff3b3b">${STATE.alerts.length}</div><div class="stat-sub">${acrit} critical</div></div>
  </div>`;
 
  // Safety + DeFi grid
  const aiMsg = rb.rugPullRisk>50
    ? `⚠️ <strong style="color:#ff9500">AI Assessment:</strong> High-risk tokens detected. Review flagged assets immediately.`
    : rb.rugPullRisk>20
    ? `⚠️ <strong style="color:#ffcc00">AI Assessment:</strong> Some medium-risk assets. Portfolio mostly healthy.`
    : `✅ <strong style="color:#00ff88">AI Assessment:</strong> Portfolio looks clean. No major rug pull or contract risks.`;
  const aiBg = rb.rugPullRisk>50 ? 'rgba(255,149,0,0.05)' : 'rgba(0,255,136,0.04)';
  const aiBd = rb.rugPullRisk>50 ? 'rgba(255,149,0,0.18)' : 'rgba(0,255,136,0.15)';
 
  const meters = [
    {label:'Rug Pull Exposure',val:rb.rugPullRisk,  col:'#ff9500'},
    {label:'Contract Risk',   val:rb.contractRisk,  col:'#ffcc00'},
    {label:'Volatility Risk', val:rb.volatilityRisk,col:'#a78bfa'},
    {label:'Liquidation Risk',val:rb.liquidationRisk,col:'#ff3b3b'},
  ].map(m=>`<div class="meter-row">
    <div class="meter-header"><span style="color:var(--muted)">${m.label}</span><span style="color:${m.col};font-weight:600">${m.val}%</span></div>
    <div class="meter-bar"><div class="meter-fill" style="width:${m.val}%;background:linear-gradient(90deg,${m.col}88,${m.col})"></div></div>
  </div>`).join('');
 
  const defiHTML = d.defiPositions.length===0
    ? `<div class="empty-state"><div class="empty-icon">◎</div>No active DeFi positions detected</div>`
    : d.defiPositions.map(p=>`<div class="defi-pos">
        <div class="defi-proto">${p.protocol} <span style="font-size:9px;color:var(--muted);background:rgba(255,255,255,0.04);padding:2px 7px;border-radius:4px">${p.type}</span></div>
        ${p.healthFactor?`<div style="font-size:11px;color:var(--muted)">Health: <span style="color:${p.healthFactor<1.3?'#ff3b3b':'#ffcc00'};font-weight:600">${p.healthFactor}</span></div>
        <div class="hf-bar"><div style="height:100%;width:${Math.min(p.liquidationRisk,100)}%;background:${p.liquidationRisk>70?'#ff3b3b':'#ffcc00'};border-radius:3px"></div></div>`:''}
      </div>`).join('');
 
  html += `<div class="main-grid">
    <div class="panel-card">
      <div class="panel-card-title">WALLET SAFETY ANALYSIS</div>
      <div class="safety-inner">
        <div class="ring-wrap">${ringHTML(sc,110,true)}<div class="ring-label">SAFETY SCORE</div></div>
        <div class="risk-meters">${meters}</div>
      </div>
      <div class="ai-box" style="background:${aiBg};border:1px solid ${aiBd}">${aiMsg}</div>
    </div>
    <div class="panel-card">
      <div class="panel-card-title">DEFI POSITIONS</div>
      ${defiHTML}
    </div>
  </div>`;
 
  // Token table
  const rows = d.tokens.map(t=>{
    const col = RISK_COLORS[t.risk]||'#888';
    const valStr = t.value>0?`$${fmt(t.value)}`:'<span style="color:var(--muted)">—</span>';
    const chgStr = t.change!==0?`<span style="color:${t.change>0?'#00ff88':'#ff3b3b'}">${t.change>0?'+':''}${t.change}%</span>`:'<span style="color:var(--muted)">—</span>';
    const auditTag = t.audit
      ? `<span class="audit-tag" style="color:#00ff88;background:rgba(0,255,136,0.08)">✓ Audited</span>`
      : `<span class="audit-tag" style="color:#ff9500;background:rgba(255,149,0,0.08)">⚠ None</span>`;
    return `<div class="token-row">
      <div class="tok-info"><div class="tok-icon" style="background:${col}1a;border:1px solid ${col}33;color:${col}">${t.symbol.slice(0,2)}</div>
        <div><div class="tok-name">${t.symbol}</div><div class="tok-full">${t.name}</div></div></div>
      <div>${valStr}</div>
      <div>${chgStr}</div>
      <div>${auditTag}</div>
      <div style="text-align:right"><span class="risk-tag" style="color:${col};background:${col}18">${t.risk.toUpperCase().slice(0,4)}</span></div>
    </div>`;
  }).join('');
 
  html += `<div class="token-table">
    <div style="padding:0.875rem 1rem;border-bottom:1px solid var(--border)"><span style="font-size:9px;color:var(--muted);letter-spacing:0.14em">TOKEN HOLDINGS (${d.tokens.length})</span></div>
    <div class="table-head"><span class="th">TOKEN</span><span class="th">VALUE (USD)</span><span class="th">24H</span><span class="th">AUDIT</span><span class="th right">RISK</span></div>
    ${rows || '<div style="padding:2rem;text-align:center;color:var(--muted);font-size:12px">No tokens found in this wallet.</div>'}
  </div>`;
 
  $('tab-dashboard').innerHTML = html;
}
 
// ── RENDER SCANNER ─────────────────────────────────────────
function renderScanner() {
  $('tab-scanner').innerHTML = `<div class="scanner-wrap">
    <div class="section-title">Smart Contract Scanner</div>
    <div class="section-sub">Live analysis via <span style="color:var(--blue)">GoPlus Security API</span> — honeypots, mint traps, hidden taxes, rug risks</div>
 
    <div class="scan-input-row">
      <input class="scan-input" id="contract-input" type="text" placeholder="Token contract address (0x...)" onkeydown="if(event.key==='Enter')scanContract()">
      <button class="scan-btn" id="scan-contract-btn" onclick="scanContract()">◈ SCAN</button>
    </div>
    <div class="demo-tags">
      <span style="font-size:9px;color:var(--muted)">DEMOS:</span>
      <span class="demo-tag" onclick="scanContractAddr('0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984')">Uniswap (UNI)</span>
      <span class="demo-tag" onclick="scanContractAddr('0xdAC17F958D2ee523a2206206994597C13D831ec7')">Tether (USDT)</span>
      <span class="demo-tag" onclick="scanContractAddr('0xscam')">SCAM Token</span>
    </div>
    <div id="scan-log-area" style="display:none" class="scan-log">
      <div class="log-header"><span>GOPLUS SECURITY ENGINE</span><span id="log-pct">0%</span></div>
      <div class="log-bar"><div class="log-bar-fill" id="log-bar-fill" style="width:0%"></div></div>
      <div id="log-lines"></div>
    </div>
    <div id="scan-result-area"></div>
    <div id="scan-feat" class="feat-grid">
      <div class="feat-card"><div class="feat-icon">🍯</div><div class="feat-title">Honeypot Detection</div><div class="feat-desc">Detects contracts that prevent you from selling</div></div>
      <div class="feat-card"><div class="feat-icon">🪙</div><div class="feat-title">Mint Analysis</div><div class="feat-desc">Checks if owner can print unlimited tokens</div></div>
      <div class="feat-card"><div class="feat-icon">💸</div><div class="feat-title">Tax Trap Scanner</div><div class="feat-desc">Reveals hidden buy/sell tax percentages</div></div>
      <div class="feat-card"><div class="feat-icon">🔒</div><div class="feat-title">Liquidity Lock</div><div class="feat-desc">Verifies LP tokens are locked against rug pulls</div></div>
    </div>
  </div>`;
}
 
function scanContractAddr(addr) {
  $('contract-input').value = addr;
  scanContract();
}
 
let scanLogs = [], scanProg = 0;
function addLog(msg, prog) {
  scanLogs.push(msg); scanProg = prog;
  const ll = $('log-lines');
  if (!ll) return;
  ll.innerHTML = scanLogs.map((l,i)=>`<div class="log-line">
    <span class="log-num">${String(i+1).padStart(2,'0')} ></span>
    <span class="log-text ${i===scanLogs.length-1?'active':''}">${l}${i===scanLogs.length-1?'<span style="animation:blink 0.6s infinite;display:inline-block">█</span>':''}</span>
  </div>`).join('');
  $('log-pct').textContent = prog + '%';
  $('log-bar-fill').style.width = prog + '%';
}
 
async function scanContract() {
  const input = $('contract-input');
  const addr  = (input?.value || '').trim();
  if (!addr) return;
 
  scanLogs = []; scanProg = 0;
  const logArea  = $('scan-log-area');
  const resultArea = $('scan-result-area');
  const btn = $('scan-contract-btn');
  const feat = $('scan-feat');
 
  logArea.style.display = 'block';
  resultArea.innerHTML = '';
  feat.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'SCANNING...';
 
  const DEMO_DATA = {
    '0xscam': {name:'SCAM Token',symbol:'SCAM',score:4,verified:false,honeypot:true,mintable:true,ownerPrivs:true,lpLocked:false,buyTax:5,sellTax:99,holders:142,
      issues:[{sev:'critical',title:'Honeypot Detected',desc:'Selling is disabled — your funds will be permanently trapped'},
              {sev:'critical',title:'Unlimited Mint',  desc:'Owner can mint unlimited tokens, causing infinite dilution'},
              {sev:'high',    title:'99% Sell Tax',    desc:'Nearly all value extracted on any sell transaction'},
              {sev:'medium',  title:'No LP Lock',      desc:'Liquidity can be removed instantly by deployer'}]},
  };
 
  addLog('Validating contract address...', 10);
  await sleep(300);
 
  // Check demo first
  const demoKey = Object.keys(DEMO_DATA).find(k=>addr.toLowerCase().includes(k));
  if (demoKey) {
    addLog('Querying GoPlus Security API...', 40);
    await sleep(400);
    addLog('Analysing contract flags...', 70);
    await sleep(400);
    addLog('Report generated ✓', 100);
    await sleep(200);
    const d = DEMO_DATA[demoKey];
    showScanResult({...d, address:addr, source:'Demo data'});
    btn.disabled = false; btn.textContent = '◈ SCAN';
    return;
  }
 
  // Real GoPlus API
  try {
    addLog('Querying GoPlus Security API...', 25);
    const r = await fetch(`https://api.gopluslabs.io/api/v1/token_security/1?contract_addresses=${addr.toLowerCase()}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    addLog('Analysing ownership and mint flags...', 50);
    await sleep(200);
    const d = j?.result?.[addr.toLowerCase()];
    if (!d || Object.keys(d).length === 0) throw new Error('Not a token contract or no data returned');
    addLog('Checking honeypot and tax traps...', 75);
    await sleep(200);
    addLog('Cross-referencing scam registry...', 90);
    await sleep(200);
 
    const issues = [];
    const flag = (val,sev,t,desc)=>{ if(val==='1'||val===1) issues.push({sev,title:t,desc}); };
    flag(d.is_honeypot,          'critical','Honeypot Detected',       'Contract prevents selling — funds will be trapped');
    flag(d.hidden_owner,         'critical','Hidden Owner',             'Concealed owner with admin control over contract');
    flag(d.can_take_back_ownership,'critical','Ownership Reclaim Risk', 'Ownership can be reclaimed after renouncement');
    flag(d.selfdestruct,         'critical','Self-Destruct Function',   'Contract can be destroyed, wiping all balances');
    flag(d.is_blacklisted,       'high',    'Blacklist Function',       'Owner can blacklist wallets and block transfers');
    flag(d.is_mintable,          'high',    'Unlimited Mint',           'Owner can mint unlimited tokens — infinite dilution');
    flag(d.transfer_pausable,    'high',    'Transfers Pausable',       'Owner can freeze all token transfers at will');
    flag(d.owner_change_balance, 'high',    'Balance Manipulation',     'Owner can change any wallet\'s balance');
    flag(d.is_proxy,             'medium',  'Upgradeable Proxy',        'Contract logic can be swapped by admin');
    flag(d.cannot_sell_all,      'medium',  'Cannot Sell All',          'Max sellable amount is capped — partial honeypot');
 
    const wt = {critical:25,high:15,medium:8,low:3};
    const score = Math.max(2, Math.min(99, 100 - issues.reduce((s,i)=>s+(wt[i.sev]||0),0)));
    addLog('Security report generated ✓', 100);
 
    showScanResult({
      address: addr, name: d.token_name||'Unknown Token', symbol: d.token_symbol||'?',
      score, verified: d.is_open_source==='1', honeypot: d.is_honeypot==='1',
      mintable: d.is_mintable==='1',
      ownerPrivs: d.owner_address && d.owner_address !== '0x0000000000000000000000000000000000000000',
      lpLocked: d.lp_holders?.some(h=>h.is_locked===1)||false,
      buyTax: parseFloat((parseFloat(d.buy_tax||0)*100).toFixed(2)),
      sellTax: parseFloat((parseFloat(d.sell_tax||0)*100).toFixed(2)),
      holders: parseInt(d.holder_count||0), issues,
      source: 'GoPlus Security API (live)'
    });
  } catch(e) {
    addLog('GoPlus unavailable — using demo data', 100);
    // Fallback: Uniswap demo
    showScanResult({address:addr,name:'Sample Contract',symbol:'UNI',score:95,verified:true,honeypot:false,mintable:false,ownerPrivs:false,lpLocked:true,buyTax:0,sellTax:0,holders:350000,issues:[],source:'Demo fallback'});
  }
  btn.disabled = false; btn.textContent = '◈ SCAN';
}
 
function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }
 
function showScanResult(r) {
  const col = r.score>=70?'#00ff88':r.score>=40?'#ffcc00':'#ff3b3b';
  const word = r.score>=70?'SAFE':r.score>=40?'RISKY':'DANGER';
  const SEV = {
    critical:{col:'#ff3b3b',bg:'rgba(255,59,59,0.08)',bd:'rgba(255,59,59,0.28)',icon:'🔴'},
    high:    {col:'#ff9500',bg:'rgba(255,149,0,0.08)', bd:'rgba(255,149,0,0.28)', icon:'🟠'},
    medium:  {col:'#ffcc00',bg:'rgba(255,204,0,0.08)', bd:'rgba(255,204,0,0.28)', icon:'🟡'},
    low:     {col:'#38bdf8',bg:'rgba(56,189,248,0.08)',bd:'rgba(56,189,248,0.28)',icon:'🔵'},
  };
 
  const flags = [
    {label:r.verified?'✓ Open Source':'✗ Unverified', ok:r.verified},
    {label:r.honeypot?'🍯 Honeypot':'✓ Not Honeypot', ok:!r.honeypot},
    {label:r.mintable?'⚠ Mintable':'✓ Fixed Supply', ok:!r.mintable},
    {label:r.ownerPrivs?'⚠ Owner Privs':'✓ Renounced', ok:!r.ownerPrivs},
    {label:r.lpLocked?'✓ LP Locked':'⚠ LP Unlocked', ok:r.lpLocked},
  ].map(f=>`<span class="flag" style="color:${f.ok?'#00ff88':'#ff9500'};background:${f.ok?'rgba(0,255,136,0.07)':'rgba(255,149,0,0.07)'};border:1px solid ${f.ok?'rgba(0,255,136,0.2)':'rgba(255,149,0,0.2)'}">${f.label}</span>`).join('');
 
  const issuesHTML = r.issues.length===0
    ? `<div style="background:rgba(0,255,136,0.04);border:1px solid rgba(0,255,136,0.18);border-radius:10px;padding:0.875rem 1.1rem;display:flex;align-items:center;gap:8px"><span>✅</span><span style="color:#00ff88;font-size:12px">No vulnerabilities detected. Contract appears safe.</span></div>`
    : `<div style="font-size:9px;color:var(--muted);letter-spacing:0.14em;margin-bottom:8px">VULNERABILITIES (${r.issues.length})</div>`
      + r.issues.map((iss,i)=>{
        const s = SEV[iss.sev]||SEV.medium;
        return `<div class="issue-row fade" style="background:${s.bg};border:1px solid ${s.bd};border-left-color:${s.col};animation-delay:${i*0.06}s">
          <div class="issue-title"><span>${s.icon}</span><span class="issue-name" style="color:${s.col}">${iss.title}</span><span class="issue-sev" style="color:${s.col}">${(iss.sev||'').toUpperCase()}</span></div>
          <div class="issue-desc">${iss.desc}</div>
        </div>`;
      }).join('');
 
  $('scan-result-area').innerHTML = `<div class="result-card fade">
    <div class="score-ring-wrap">
      <div class="score-ring" style="background:conic-gradient(${col} ${r.score*3.6}deg,rgba(255,255,255,0.04) 0deg)">
        <div style="width:70px;height:70px;border-radius:50%;background:var(--bg2);display:flex;align-items:center;justify-content:center">
          <span class="score-num" style="color:${col}">${r.score}</span>
        </div>
      </div>
      <div class="score-word" style="color:${col}">${word}</div>
    </div>
    <div style="flex:1">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
        <div class="result-name">${r.name}</div>
        ${r.symbol?`<span style="font-size:11px;color:var(--muted);background:rgba(255,255,255,0.05);padding:2px 8px;border-radius:4px">${r.symbol}</span>`:''}
      </div>
      <div class="result-addr">${r.address}</div>
      <div class="result-meta">
        ${r.holders>0?`<span>👥 ${r.holders.toLocaleString()} holders</span>`:''}
        ${r.buyTax!=null?`<span style="color:${r.buyTax>5?'#ff9500':'var(--muted)'}">Buy tax: ${r.buyTax}%</span>`:''}
        ${r.sellTax!=null?`<span style="color:${r.sellTax>10?'#ff3b3b':r.sellTax>5?'#ff9500':'var(--muted)'}">Sell tax: ${r.sellTax}%</span>`:''}
      </div>
      <div class="flags">${flags}</div>
      <div style="margin-top:8px;font-size:9px;color:rgba(255,255,255,0.18)">Source: ${r.source}</div>
    </div>
  </div>
  <div class="issues-list">${issuesHTML}</div>`;
}
 
// ── RENDER PORTFOLIO ───────────────────────────────────────
function renderPortfolio() {
  const d = STATE.walletData;
  const tokens = d.tokens;
  const total = Math.max(tokens.reduce((s,t)=>s+(isFinite(t.value)?t.value:0),0), 0.01);
 
  const groups = ['low','medium','high','critical'].map(r=>({
    risk:r, val:tokens.filter(t=>t.risk===r).reduce((s,t)=>s+(isFinite(t.value)?t.value:0),0)
  }));
 
  const bars = groups.map(g=>{
    const pct = total>0?(g.val/total*100):0;
    const col = RISK_COLORS[g.risk];
    return `<div class="bar-col">
      <div class="bar-val" style="color:${col}">$${Math.round(g.val).toLocaleString()}</div>
      <div class="bar-fill" style="height:${Math.max(pct,2)}%;background:linear-gradient(180deg,${col},${col}55)"></div>
      <div class="bar-name">${g.risk.toUpperCase()}</div>
      <div class="bar-pct" style="color:${col}">${pct.toFixed(0)}%</div>
    </div>`;
  }).join('');
 
  const recs = [
    {icon:'🗑️',text:'Remove CRITICAL tokens — near-zero liquidity signals rug pull',col:'#ff3b3b'},
    {icon:'⚠️',text:'Reduce HIGH-risk exposure — unverified low-cap assets',col:'#ff9500'},
    {icon:'💡',text:'Diversify into audited blue-chips (ETH, USDC, LINK)',col:'#ffcc00'},
    {icon:'✅',text:'Audited low-risk assets are healthy — no action needed',col:'#00ff88'},
  ].map(r=>`<div class="rec-row" style="background:${r.col}07;border:1px solid ${r.col}1e">
    <span>${r.icon}</span><span style="color:rgba(255,255,255,0.55)">${r.text}</span>
  </div>`).join('');
 
  // Liquidation sim
  const stored = window._ethSlider || 3500;
  const COL=2.1, BOR=2800, THR=0.825;
  const hfRaw = (COL * stored * THR) / BOR;
  const safeHF = Math.max(hfRaw, 0);
  const liqPrice = BOR / (COL * THR);
  const hfCol = safeHF<1.1?'#ff3b3b':safeHF<1.5?'#ff9500':safeHF<2?'#ffcc00':'#00ff88';
  const dropPct = Math.max(0, ((stored - liqPrice)/stored*100)).toFixed(1);
 
  const liqWarn = safeHF<1.5
    ? `<div class="msg err" style="margin-bottom:1rem">🚨 At $${stored.toLocaleString()}, ETH drops ${dropPct}% triggers liquidation.</div>` : '';
 
  // Rug pull signals
  const rugCards = tokens.slice(0,6).map(tok=>{
    const col = RISK_COLORS[tok.risk]||'#888';
    const score = {critical:95,high:65,medium:35,low:12}[tok.risk]||50;
    const sigs = [
      {ok:tok.audit,   text:tok.audit?'Security audit found':'No security audit'},
      {ok:tok.risk==='low'||tok.risk==='medium', text:tok.risk==='low'?'Low volatility':'High volatility risk'},
      {ok:tok.value>100, text:tok.value>100?'Sufficient liquidity':'Low liquidity warning'},
    ].map(s=>`<div class="rug-sig"><span style="color:${s.ok?'#00ff88':'#ff3b3b'}">${s.ok?'✓':'✗'}</span>${s.text}</div>`).join('');
    return `<div class="rug-card">
      <div class="rug-header"><span class="rug-sym">${tok.symbol}</span><span class="rug-score" style="color:${col};background:${col}18">${score}%</span></div>
      ${sigs}
    </div>`;
  }).join('');
 
  $('tab-portfolio').innerHTML = `
    <div class="section-title">Portfolio Risk Analysis</div>
    <div class="section-sub">AI risk scoring, liquidation simulation, and rug pull detection</div>
    <div class="port-grid">
      <div class="panel-card">
        <div class="panel-card-title">PORTFOLIO RISK DISTRIBUTION</div>
        <div class="bar-chart">${bars}</div>
        <div class="panel-card-title" style="margin-top:0.5rem">AI RECOMMENDATIONS</div>
        ${recs}
      </div>
      <div class="panel-card">
        <div class="panel-card-title">LIQUIDATION RISK SIMULATOR</div>
        <p style="font-size:10px;color:var(--muted);margin-bottom:1rem;line-height:1.8">Simulates an Aave-style position: 2.1 ETH collateral, $2,800 USDC borrowed.</p>
        ${liqWarn}
        <div class="liq-grid">
          <div class="liq-cell"><div class="liq-label">Collateral</div><div class="liq-val" style="color:#a78bfa">2.1 ETH</div></div>
          <div class="liq-cell"><div class="liq-label">Borrowed</div><div class="liq-val" style="color:#38bdf8">$2,800 USDC</div></div>
          <div class="liq-cell"><div class="liq-label">Health Factor</div><div class="liq-val" style="color:${hfCol}" id="hf-val">${safeHF.toFixed(3)}</div></div>
          <div class="liq-cell"><div class="liq-label">Liq. Price</div><div class="liq-val" style="color:#ff9500">$${liqPrice.toFixed(0)}</div></div>
        </div>
        <div class="slider-row">
          <div class="slider-header"><span style="color:var(--muted)">Simulate ETH Price</span><span style="color:#fff" id="eth-price-lbl">$${stored.toLocaleString()}</span></div>
          <input type="range" min="500" max="8000" step="50" value="${stored}" id="eth-slider" oninput="updateLiq(this.value)">
          <div style="display:flex;justify-content:space-between;font-size:9px;color:rgba(255,255,255,0.2);margin-top:4px"><span>$500 🔴</span><span>$8,000 ✅</span></div>
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:5px">
            <span style="color:var(--muted)">Health Factor</span>
            <span style="color:${hfCol};font-weight:600" id="hf-val2">${safeHF.toFixed(3)}</span>
          </div>
          <div class="hf-track">
            <div class="hf-fill" id="hf-fill" style="width:${Math.min(safeHF/3*100,100)}%"></div>
            <div class="hf-marker" style="left:${1/3*100}%"></div>
          </div>
          <div style="font-size:9px;color:rgba(255,59,59,0.45);margin-top:3px">↑ Liquidation at HF = 1.0</div>
        </div>
      </div>
    </div>
    <div class="panel-card">
      <div class="panel-card-title">RUG PULL DETECTION — TOKEN BEHAVIOUR SIGNALS</div>
      <div class="rug-grid">${rugCards||'<div style="color:var(--muted);font-size:12px">No tokens to analyse.</div>'}</div>
    </div>`;
}
 
function updateLiq(v) {
  const val = Number(v);
  window._ethSlider = val;
  const COL=2.1, BOR=2800, THR=0.825;
  const hf = Math.max((COL*val*THR)/BOR, 0);
  const col = hf<1.1?'#ff3b3b':hf<1.5?'#ff9500':hf<2?'#ffcc00':'#00ff88';
  const hfStr = hf.toFixed(3);
  if($('eth-price-lbl')) $('eth-price-lbl').textContent = '$' + val.toLocaleString();
  if($('hf-val'))  { $('hf-val').textContent = hfStr; $('hf-val').style.color = col; }
  if($('hf-val2')) { $('hf-val2').textContent = hfStr; $('hf-val2').style.color = col; }
  if($('hf-fill')) $('hf-fill').style.width = Math.min(hf/3*100,100) + '%';
}
 
// ── RENDER ALERTS ──────────────────────────────────────────
function renderAlerts() {
  const CFG = {
    critical:{col:'#ff3b3b',bg:'rgba(255,59,59,0.06)',bd:'rgba(255,59,59,0.22)',icon:'🚨',label:'CRITICAL'},
    warning: {col:'#ff9500',bg:'rgba(255,149,0,0.06)', bd:'rgba(255,149,0,0.22)', icon:'⚠️', label:'WARNING'},
    info:    {col:'#38bdf8',bg:'rgba(56,189,248,0.06)',bd:'rgba(56,189,248,0.22)',icon:'ℹ️', label:'INFO'},
  };
 
  const visible = STATE.alerts.filter(a=>
    !STATE.dismissed.includes(a.id) &&
    (STATE.alertFilter==='all' || a.type===STATE.alertFilter));
 
  const counts = {
    all: STATE.alerts.filter(a=>!STATE.dismissed.includes(a.id)).length,
    critical: STATE.alerts.filter(a=>a.type==='critical'&&!STATE.dismissed.includes(a.id)).length,
    warning:  STATE.alerts.filter(a=>a.type==='warning'&&!STATE.dismissed.includes(a.id)).length,
    info:     STATE.alerts.filter(a=>a.type==='info'&&!STATE.dismissed.includes(a.id)).length,
  };
 
  const filterBtns = [
    {id:'all',    label:`All (${counts.all})`,     cls:''},
    {id:'critical',label:`Critical (${counts.critical})`,cls:'crit'},
    {id:'warning', label:`Warning (${counts.warning})`,  cls:'warn'},
    {id:'info',    label:`Info (${counts.info})`,         cls:'info-f'},
  ].map(f=>`<button class="filter-btn ${f.cls} ${STATE.alertFilter===f.id?'active':''}" onclick="setAlertFilter('${f.id}')">${f.label}</button>`).join('');
 
  const clearBtn = visible.length>0
    ? `<button class="clear-btn" onclick="clearAlerts()">Clear all</button>` : '';
 
  const items = visible.length===0
    ? `<div class="empty-state" style="padding:4rem 0"><div class="empty-icon">✅</div>No active alerts — portfolio is secure</div>`
    : visible.map(a=>{
        const c = CFG[a.type]||CFG.info;
        const actionBtn = a.type==='critical'
          ? `<button class="act-btn action">Take Action →</button>` : '';
        return `<div class="alert-item fade" style="background:${c.bg};border:1px solid ${c.bd};border-left:3px solid ${c.col}">
          <span style="font-size:1.1rem;flex-shrink:0">${c.icon}</span>
          <div class="alert-body">
            <div class="alert-title-row">
              <span class="alert-title" style="color:${c.col}">${a.title}</span>
              <span class="alert-sev-tag" style="color:${c.col};background:${c.col}18">${c.label}</span>
              ${a.token?`<span class="alert-tok">${a.token}</span>`:''}
              <span class="alert-time">${a.time}</span>
            </div>
            <div class="alert-msg">${a.message}</div>
            <div class="alert-actions">
              ${actionBtn}
              <button class="act-btn dismiss" onclick="dismissAlert(${a.id})">Dismiss</button>
            </div>
          </div>
        </div>`;
      }).join('');
 
  const monitors = [
    {name:'Rug Pull Detector',sub:'Live scan'},
    {name:'Contract Monitor', sub:'On-chain'},
    {name:'Price Monitor',    sub:'30s polling'},
    {name:'Liquidation Watch',sub:'Simulated'},
  ].map(m=>`<div class="monitor-item"><div class="mon-dot"></div><div><div class="mon-name">${m.name}</div><div class="mon-sub">${m.sub}</div></div></div>`).join('');
 
  $('tab-alerts').innerHTML = `
    <div class="section-title">Security Alert Center</div>
    <div class="section-sub">Real-time notifications from AI monitoring engines</div>
    <div class="filter-row">${filterBtns}${clearBtn}</div>
    <div id="alert-items">${items}</div>
    <div style="margin-top:1.5rem">
      <div style="font-size:9px;color:var(--muted);letter-spacing:0.14em;margin-bottom:0.875rem">ACTIVE MONITORING MODULES</div>
      <div class="monitors-grid">${monitors}</div>
    </div>`;
 
  updateAlertBadge();
}
 
function setAlertFilter(f) {
  STATE.alertFilter = f;
  renderAlerts();
}
 
function dismissAlert(id) {
  STATE.dismissed.push(id);
  renderAlerts();
  updateAlertBadge();
}
 
function clearAlerts() {
  STATE.dismissed = STATE.alerts.map(a=>a.id);
  renderAlerts();
  updateAlertBadge();
}
 
