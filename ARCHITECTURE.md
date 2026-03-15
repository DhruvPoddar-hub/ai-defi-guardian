# 🏗️ Architecture & Technical Documentation

## Overview

AI DeFi Guardian is a **fully client-side** single-page application. There is no backend, no database, no server, and no build step. All blockchain data is fetched directly from public APIs in the user's browser.

---

## File Architecture

```
index.html   →  Static HTML shell (3 screens, 4 tab panels)
styles.css   →  CSS variables, layout, components, animations
app.js       →  All JavaScript: state, APIs, rendering, Web3
```

### Separation of Concerns

| Concern | File | Details |
|---|---|---|
| Structure | `index.html` | DOM skeleton, semantic elements, link tags |
| Presentation | `styles.css` | CSS custom properties, Flexbox/Grid layout, keyframe animations |
| Logic | `app.js` | Global state object, API calls, DOM rendering, Web3 integration |

---

## State Management

A single global `STATE` object holds all application state:

```javascript
let STATE = {
  address:       null,    // Connected wallet address (string)
  walletData:    null,    // Full portfolio data object
  alerts:        [],      // Array of alert objects
  dismissed:     [],      // Array of dismissed alert IDs
  mmConnected:   false,   // Whether connected via MetaMask
  scanning:      false,   // Whether a scan is in progress
  alertFilter:   'all',   // Current alert filter tab
  mmTimeout:     null,    // MetaMask connection timeout ref
  _monitorInterval: null  // Real-time alert polling interval ref
};
```

DOM is re-rendered by calling the appropriate `render*()` function after any state mutation. No virtual DOM, no reactive framework — direct `innerHTML` writes to tab panel divs.

---

## API Layer

### Primary: Ethplorer
```
GET https://api.ethplorer.io/getAddressInfo/{address}?apiKey=freekey

Returns:
  ETH.balance          → native ETH balance
  ETH.price.rate       → current ETH/USD price
  ETH.price.diff       → 24h % change
  tokens[].rawBalance  → raw ERC-20 balance (divide by 10^decimals)
  tokens[].tokenInfo.symbol
  tokens[].tokenInfo.decimals
  tokens[].tokenInfo.price.rate  → token USD price
```

### Fallback: Ankr Multichain
```
POST https://rpc.ankr.com/multichain

Body: {
  jsonrpc: "2.0",
  method: "ankr_getAccountBalance",
  params: { blockchain: ["eth"], walletAddress: addr }
}

Returns: result.assets[] with balanceUsd, tokenSymbol, balance
```

### Fallback: Raw Ethereum JSON-RPC
```
POST https://cloudflare-eth.com  (or eth.llamarpc.com, rpc.ankr.com/eth, etc.)

Body: {
  jsonrpc: "2.0",
  method: "eth_getBalance",
  params: [address, "latest"]
}

Returns: result (hex Wei string)
Wei → ETH: Number(BigInt(hexWei)) / (10 ** 18)
```

### Contract Scanner: GoPlus Security
```
GET https://api.gopluslabs.io/api/v1/token_security/1?contract_addresses={addr}

Returns result[address]:
  is_honeypot           "0" | "1"
  is_mintable           "0" | "1"
  is_blacklisted        "0" | "1"
  hidden_owner          "0" | "1"
  can_take_back_ownership "0" | "1"
  selfdestruct          "0" | "1"
  transfer_pausable     "0" | "1"
  owner_change_balance  "0" | "1"
  is_proxy              "0" | "1"
  cannot_sell_all       "0" | "1"
  buy_tax               "0.05" (decimal fraction, multiply × 100 for %)
  sell_tax              "0.99"
  holder_count          "142"
  lp_holders[].is_locked  1 | 0
  token_name, token_symbol
```

### Prices: CoinGecko
```
GET https://api.coingecko.com/api/v3/simple/price
  ?ids=ethereum,usd-coin,tether,...
  &vs_currencies=usd
  &include_24hr_change=true

Returns: { ethereum: { usd: 3421.50, usd_24h_change: 2.3 }, ... }
Cached in memory for 60 seconds to avoid rate limiting.
```

### DeFi Positions: Aave V3 Subgraph
```
POST https://api.thegraph.com/subgraphs/name/aave/protocol-v3

GraphQL Query:
{
  user(id: "{address}") {
    healthFactor
    reserves {
      currentATokenBalance
      currentVariableDebt
      currentStableDebt
      reserve {
        symbol
        decimals
        price { priceInEth }
        liquidationThreshold
      }
    }
  }
}
```

---

## Web3 Integration

### MetaMask Connection Flow
```
1. Check window.ethereum !== undefined
2. Call eth_requestAccounts → opens MetaMask popup
3. Set 60-second timeout (clears on success or error)
4. On success: call eth_chainId
5. If chainId !== "0x1": call wallet_switchEthereumChain
6. Pass address to startScan()
7. Register event listeners:
   - accountsChanged → re-scan new account or disconnect
   - chainChanged → disconnect (force re-connect on correct chain)
```

### Error Handling
| Error Code | Meaning | Response |
|---|---|---|
| `4001` | User rejected | "Click Connect and approve the popup" |
| `-32002` | Popup already open | "Click the 🦊 icon in your toolbar" |
| timeout | No response in 60s | "Open MetaMask popup and respond" |
| switch failed | Can't switch chain | "Manually switch to Ethereum Mainnet" |

---

## Risk Scoring Algorithm

### Safety Score (0–100)
Higher = safer. Score starts at 100 and deductions are applied.

```javascript
// Per-token risk classification
function classifyRisk(symbol, usdValue) {
  if (SAFE_TOKENS.has(symbol))  return 'low';      // ETH, USDC, WBTC, etc.
  if (MEDIUM_TOKENS.has(symbol)) return 'medium';  // SHIB, PEPE, CRV, etc.
  if (usdValue < 10)  return 'critical';           // Unknown micro-cap
  if (usdValue < 200) return 'high';               // Unknown low-cap
  return 'medium';
}

// Portfolio-level scoring
const rugPullRisk    = min(90, (highRiskUSD / totalUSD × 80) + (unauditedCount × 4))
const contractRisk   = min(90, unauditedCount × 10)
const volatilityRisk = min(90, nonLowRiskCount / tokenCount × 85)
const safetyScore    = max(5, min(99, 100 − (rug×0.35 + contract×0.25 + vol×0.40)))
```

### Contract Vulnerability Score
GoPlus flags are parsed and assigned severity weights:

```javascript
// Deducted from 100 per vulnerability found
weights = { critical: 25, high: 15, medium: 8, low: 3 }
score = max(2, min(99, 100 − sum(weights[issue.severity])))
```

---

## Real-Time Alert Monitor

Runs every 30 seconds after wallet connects:

```javascript
setInterval(async () => {
  const prices = await getCachedPrices();  // 60s cache — no extra API calls
  for (const token of walletData.tokens) {
    const current  = prices[token.symbol]?.usd;
    const previous = prevPrices[token.symbol];
    if (!current || !previous) continue;
    
    const dropPct = (previous - current) / previous * 100;
    if (dropPct > 8)  → CRITICAL alert  (rug pull signal)
    if (dropPct > 4)  → WARNING alert   (significant drop)
    
    // Deduplicate: skip if same token alerted within 120 seconds
  }
  prevPrices = { ...prices };
}, 30_000);
```

---

## Rendering Architecture

Each tab has a dedicated `render*()` function that builds HTML as a string and assigns it to `innerHTML`:

```javascript
function renderDashboard() { $('tab-dashboard').innerHTML = buildHTML(); }
function renderScanner()   { $('tab-scanner').innerHTML   = buildHTML(); }
function renderPortfolio() { $('tab-portfolio').innerHTML = buildHTML(); }
function renderAlerts()    { $('tab-alerts').innerHTML    = buildHTML(); }
```

All renders are called once after data loads, and re-called on refresh or state changes (alert dismiss, filter change, slider move).

---

## API Fallback Chain

```
fetchWalletData(address)
  │
  ├─ [1] Ethplorer getAddressInfo
  │       ✓ Returns → build tokens + return result
  │       ✗ Fails  → continue to [2]
  │
  ├─ [2] Ankr ankr_getAccountBalance + CoinGecko prices
  │       ✓ Returns → build tokens + return result
  │       ✗ Fails  → continue to [3]
  │
  └─ [3] Loop through 4 raw RPC endpoints:
           cloudflare-eth.com
           eth.llamarpc.com
           rpc.ankr.com/eth
           ethereum.publicnode.com
           ✓ Any returns → show ETH-only + return result
           ✗ All fail   → throw Error (shown to user)
```

This gives the app near-100% uptime even if individual providers go down.

---

## CSS Architecture

All colours, spacing, and component tokens are defined as CSS custom properties on `:root`:

```css
:root {
  --green:  #00ff88;   /* primary accent */
  --orange: #f58220;   /* MetaMask / warning */
  --red:    #ff3b3b;   /* critical / danger */
  --yellow: #ffcc00;   /* warning / medium risk */
  --blue:   #38bdf8;   /* info */
  --bg:     #050508;   /* page background */
  --bg2:    #0a0a12;   /* card background */
  --border: rgba(255,255,255,0.07);
  --muted:  rgba(255,255,255,0.35);
}
```

Components use semantic class names (`.panel-card`, `.stat-card`, `.token-row`, `.alert-item`) with no inline styles in HTML, keeping structure and presentation cleanly separated.
