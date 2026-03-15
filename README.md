# 🛡️ AI DeFi Guardian

> **An AI-powered real-time security platform that protects DeFi investors from rug pulls, smart contract exploits, and liquidation risks — before funds are lost.**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Web3](https://img.shields.io/badge/Web3-MetaMask-orange.svg)](https://metamask.io)
[![Network](https://img.shields.io/badge/Network-Ethereum-blue.svg)](https://ethereum.org)
[![Live Demo](https://img.shields.io/badge/Demo-GitHub%20Pages-brightgreen.svg)](https://YOUR-USERNAME.github.io/ai-defi-guardian/)

---

## 🔴 Problem Statement

The DeFi ecosystem loses **billions of dollars every year** to completely preventable attacks:

| Problem | Annual Scale |
|---|---|
| Rug pulls & scam tokens | $2.8B lost in 2023 alone |
| Smart contract honeypots | $1.3B trapped in malicious contracts |
| Liquidation cascades | $500M+ in forced liquidations |
| Uninformed new users | 73% of DeFi users have zero security tools |

**Current tools are fragmented.** A user must check 4–6 different websites before safely interacting with any token or protocol. There is no unified, real-time security layer built for the average DeFi user.

---

## ✅ Solution

**AI DeFi Guardian** is a zero-setup security dashboard that:

1. Connects to your MetaMask wallet in one click
2. Fetches your live on-chain portfolio from Ethereum mainnet
3. Runs AI-powered risk scoring across all holdings
4. Scans any smart contract for exploits via GoPlus Security API
5. Monitors prices every 30 seconds and fires alerts on suspicious drops
6. Simulates liquidation scenarios for active Aave lending positions

**Zero backend. Zero API keys. Opens in any browser. Works in under 10 seconds.**

---

## ✨ Features

| Feature | Description |
|---|---|
| 🦊 **MetaMask Connect** | One-click wallet connection with auto mainnet switching & event listeners |
| 📊 **Live Portfolio** | Real ETH + ERC-20 balances with USD values, 24h changes, audit status |
| 🛡️ **AI Safety Score** | Wallet score 0–100 using rug pull, contract risk, and volatility metrics |
| ◈ **Contract Scanner** | GoPlus-powered: honeypots, unlimited mint, hidden taxes, LP lock status |
| ⚡ **DeFi Positions** | Aave V3 health factor, liquidation threshold, and borrow/supply breakdown |
| 📉 **Liquidation Sim** | Drag ETH price slider — live health factor recalculation using Aave formula |
| 🚨 **Real-Time Alerts** | 30s price polling — Critical on >8% drop, Warning on >4% drop |
| 🔍 **Rug Pull Detection** | Per-token signal scoring: audit, liquidity, volatility, on-chain flags |

---

## 🏗️ System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        USER BROWSER                          │
│                                                              │
│  ┌──────────────┐   ┌────────────────────────────────────┐  │
│  │   MetaMask   │◄─►│        AI DeFi Guardian            │  │
│  │  (EIP-1193)  │   │   index.html · styles.css · app.js │  │
│  └──────────────┘   └────────────────┬───────────────────┘  │
│                                      │ fetch() calls        │
└──────────────────────────────────────┼──────────────────────┘
                                       │
          ┌────────────────────────────┼────────────────────────┐
          │                            │                        │
          ▼                            ▼                        ▼
 ┌─────────────────┐       ┌──────────────────┐    ┌──────────────────┐
 │ Ethplorer API   │       │ GoPlus Security  │    │  CoinGecko API   │
 │ getAddressInfo  │       │ token_security/1 │    │  simple/price    │
 │ ETH + ERC-20s   │       │ Contract scanner │    │  Live prices     │
 └────────┬────────┘       └──────────────────┘    └──────────────────┘
          │ fallback
    ┌─────┴──────────────────────┐           ┌──────────────────────┐
    │                            │           │  Aave V3 Subgraph    │
    ▼                            ▼           │  (The Graph)         │
┌──────────────┐      ┌──────────────────┐   │  DeFi positions      │
│ Ankr RPC     │      │ Cloudflare ETH   │   │  Health factors      │
│ Multichain   │      │ JSON-RPC         │   └──────────────────────┘
└──────────────┘      └──────────────────┘
```

### Request Flow

```
[1] User clicks Connect → MetaMask eth_requestAccounts → returns address
[2] fetchWalletData()
     ├── Ethplorer getAddressInfo  (ETH + tokens + USD prices in 1 call)
     ├── fallback: Ankr ankr_getAccountBalance + CoinGecko prices
     └── fallback: Cloudflare eth_getBalance + CoinGecko prices
[3] fetchDefiPositions()
     └── Aave V3 subgraph → GraphQL query → health factor + positions
[4] AI Risk Engine
     ├── classifyRisk()   per token → low / medium / high / critical
     ├── safetyScore()    weighted formula across 4 dimensions
     └── buildAlerts()    auto-generate alerts from risk findings
[5] Render dashboard, scanner, portfolio, alerts
[6] startAlertMonitor()  → polls CoinGecko every 30s → price crash detection
```

---

## 🔌 APIs & Web3 Integration

| API / Protocol | Type | Purpose | Key Required |
|---|---|---|---|
| MetaMask `window.ethereum` | Web3 EIP-1193 | Wallet auth, account events | Browser extension |
| [Ethplorer](https://ethplorer.io/api) | REST | ETH + ERC-20 balances + prices | `freekey` (public) |
| [GoPlus Security](https://gopluslabs.io) | REST | Smart contract vulnerability scan | None |
| [CoinGecko](https://coingecko.com/api) | REST | Live token prices + 24h changes | None |
| [Ankr Multichain](https://ankr.com/docs/advanced-api) | JSON-RPC | Token balance fallback | None |
| [Cloudflare ETH RPC](https://cloudflare-eth.com) | JSON-RPC | ETH balance fallback | None |
| [LlamaRPC](https://eth.llamarpc.com) | JSON-RPC | ETH balance fallback | None |
| [Aave V3 Subgraph](https://thegraph.com) | GraphQL | Live DeFi positions | None |

**All APIs are free. No API keys required. No backend server needed.**

---

## 🧠 AI Risk Scoring Methodology

### Wallet Safety Score Formula
```
SafetyScore = 100 − (rugPullRisk × 0.35)
                  − (contractRisk × 0.25)
                  − (volatilityRisk × 0.40)

rugPullRisk    = min(90, (highRiskValue / totalValue × 80) + (unauditedCount × 4))
contractRisk   = min(90, unauditedCount × 10)
volatilityRisk = min(90, nonLowRiskTokens / totalTokens × 85)
```

### Token Risk Classification

| Level | Color | Criteria |
|---|---|---|
| Low 🟢 | `#00ff88` | Known audited tokens: ETH, USDC, USDT, WBTC, LINK, UNI, AAVE, ARB... |
| Medium 🟡 | `#ffcc00` | Known mid-cap: SHIB, PEPE, CRV, LDO, MKR, COMP, SUSHI... |
| High 🟠 | `#ff9500` | Unknown token with USD value $10–$200 |
| Critical 🔴 | `#ff3b3b` | Unknown token with USD value < $10 |

### Contract Vulnerability Weights (GoPlus)
```
Critical (+25 pts deducted): Honeypot, Hidden Owner, Self-Destruct, Ownership Reclaim
High     (+15 pts deducted): Blacklist, Unlimited Mint, Transfer Pause, Balance Manipulation
Medium   (+8  pts deducted):  Proxy Upgrade, Cannot Sell All
Low      (+3  pts deducted):  Trading Cooldown, Anti-Whale
```

### Liquidation Formula (Aave V3)
```
HealthFactor = (collateralETH × liquidationThreshold) / totalBorrowedUSD
Liquidation triggered when HF < 1.0
```

---

## 🛠️ Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | Vanilla HTML5 + CSS3 + JS (ES2022) | Zero build step, instant load, no framework bloat |
| Web3 | MetaMask EIP-1193 `window.ethereum` | Industry standard wallet provider |
| Blockchain | Ethereum Mainnet (Chain ID: 0x1) | Largest DeFi ecosystem |
| Contract Security | GoPlus Security API | Powers Trust Wallet, 1inch, PancakeSwap |
| Portfolio Data | Ethplorer + Ankr + Cloudflare RPC | 3-layer fallback for 99.9% uptime |
| DeFi Positions | Aave V3 via The Graph (GraphQL) | Real on-chain lending data |
| Price Data | CoinGecko with 60s in-memory cache | Free, accurate, rate-limit safe |
| Hosting | GitHub Pages | Free, CDN-backed, HTTPS |

---

## 🚀 Getting Started

### Prerequisites
- Any modern browser (Chrome, Firefox, Brave, Edge)
- [MetaMask](https://metamask.io) extension (optional — manual address entry also works)

### Run Locally
```bash
# Clone
git clone https://github.com/YOUR-USERNAME/ai-defi-guardian.git
cd ai-defi-guardian

# Open directly — zero install, zero build
open index.html          # macOS
start index.html         # Windows
xdg-open index.html      # Linux
```

> **Note:** If MetaMask doesn't connect via `file://`, use a local server:
> ```bash
> npx serve .            # Node.js
> python3 -m http.server 8080   # Python
> ```

### Deploy to GitHub Pages
```bash
git init
git add .
git commit -m "🛡️ Initial commit — AI DeFi Guardian"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/ai-defi-guardian.git
git push -u origin main
```
**GitHub → Settings → Pages → Deploy from main → Save**

Live at: `https://YOUR-USERNAME.github.io/ai-defi-guardian/`

---

## 📖 Usage Guide

### Step 1 — Connect
- Click **🦊 Connect MetaMask** and approve the popup  
  *or* paste any Ethereum address and click **⬡ SCAN ADDRESS**

### Step 2 — Review Dashboard
- Check your **Safety Score** ring and 4 risk meters
- Review token holdings sorted by USD value
- Look for red/orange risk tags

### Step 3 — Scan a Contract
- Go to **Contract Scanner**
- Paste any ERC-20 token contract address
- Results in ~2 seconds via GoPlus API

### Step 4 — Simulate Liquidation
- Go to **Portfolio Risk**
- Drag the ETH price slider to test your Aave position
- Watch the health factor update in real time

### Step 5 — Monitor Alerts
- **Alert Center** auto-populates with live risk events
- Price crash alerts fire every 30 seconds automatically

---

## 📈 Scalability Roadmap

| Version | Feature |
|---|---|
| v2.0 | Multi-chain: Polygon, Arbitrum, Base, BSC |
| v2.1 | Browser extension — warns before each transaction |
| v2.2 | Telegram / Email webhook alerts |
| v3.0 | On-chain reputation contract — community-flagged scam registry |
| v3.1 | DAO governance for token risk classifications |

---

## 🔐 Security & Privacy

- ✅ **Read-only** — never requests `eth_sendTransaction` or signing
- ✅ **No private keys** accessed, stored, or transmitted
- ✅ **No backend** — zero server, zero database
- ✅ **No tracking** — no analytics, cookies, or data collection
- ✅ MetaMask only shares your **public wallet address**

---

## 🌍 Real-World Impact

- **$4.1B+** lost annually to attacks this tool detects
- Works for **complete beginners** — no Web3 knowledge needed
- Provides **institutional-grade security checks** in seconds, free
- Usable by anyone with an Ethereum wallet address — no signup

---

## 📁 Project Structure

```
ai-defi-guardian/
├── index.html          # App shell — HTML structure & layout
├── styles.css          # All CSS: layout, components, animations
├── app.js              # All logic: state, APIs, rendering, Web3
├── README.md           # Full documentation (this file)
├── LICENSE             # MIT License
└── .gitignore          # Git ignore rules
```

### File Responsibilities

| File | Lines | Responsibility |
|---|---|---|
| `index.html` | 132 | Static HTML structure, 3 screens, links to CSS + JS |
| `styles.css` | 221 | All visual styling, CSS variables, animations, responsive |
| `app.js` | 923 | State management, all API calls, all render functions, Web3 |

---

## 💡 One-Line Pitch

> *AI DeFi Guardian is an AI-powered, real-time security platform that scans wallets, contracts, and DeFi positions — protecting users from rug pulls, exploits, and liquidations before funds are lost.*

---


---

## 📄 License

[MIT License](LICENSE) — free to use, fork, and extend.
