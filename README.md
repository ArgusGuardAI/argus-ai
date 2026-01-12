# WhaleShield 🐋🛡️

> The AI-Powered Graffiti Layer for the Solana Ecosystem.

**WhaleShield** is a browser extension that transforms Pump.fun and Crypto Twitter from a chaotic minefield into a secure, transparent trading terminal. By leveraging **Community Notes** and **Real-Time AI Analysis**, WhaleShield protects you from rugs, honeypots, and scams—before you click buy.

---

## 🚀 Features

### The Triple-Layer Shield

*   **🛡️ AI Honeypot Detector:** Instantly analyzes Solana smart contracts (via Together AI) to detect hidden tax codes that prevent you from selling.
*   **👀 The Graffiti Layer:** Annotate Pump.fun coins and Twitter threads with sticky notes visible only to the WhaleShield Crew.
*   **💎 The Paint Filter:** Community-driven safety painting. Scam coins are painted Red. Verified gems are painted Green.
*   **🔍 Wallet History Scanner:** Visualizes a developer's previous on-chain activity. See if they have rugged before—right on the card.
*   **⚡ Zero-Latency:** Powered by Cloudflare Workers and Together AI for instant feedback, cached at the edge.

---

## ⚔️ The "Hold-to-Use" Barrier

WhaleShield is free to use, but requires a **License Key**.

*   **The Token:** **$WHALESHIELD** (Launched on Pump.fun).
*   **The Rule:** You must **Hold 1,000 $WHALESHIELD** in your wallet.
*   **The Mechanism:**
    1.  **No Staking:** We do not lock your tokens. You have full control.
    2.  **Presto Verification:** The extension checks your balance via a Public RPC.
    3.  **Instant Unlock:** If `Balance >= 1,000`, the Shield activates.
    4.  **Instant Off:** If you sell below 1,000, the Shield deactivates immediately.

---

## 🛠️ Tech Stack

We built the **"Cheapest Possible"** architecture to ensure zero monthly overhead.

| Component | Tech Choice | Purpose |
| :--- | :--- | :--- |
| **Frontend** | **Plasmo (React)** | The Overlay Engine & DOM manipulation. |
| **Authentication** | **Public RPC (Solana)** | Read-only balance check ($0 cost). |
| **Backend** | **Cloudflare Workers** | Serverless routing & API handling (Free Tier). |
| **AI Engine** | **Together AI** | Real-time honeypot detection & contract analysis. |
| **Database** | **Supabase (Postgres)** | Stores encrypted "Graffiti" notes (Free Tier). |
| **Cache** | **Cloudflare KV** | Stores recent contract scans to save AI costs. |

---

## 📋 Installation

### Prerequisites
*   A modern browser (Chrome, Brave, Arc, Firefox).
*   A Solana Wallet (Phantom, Solflare).
*   **1,000 $WHALESHIELD** Tokens.

### Setup

1.  **Install:** Download `whaleshield-v1.0.crx` from the [Releases](https://github.com/yourusername/whaleshield/releases) page.
2.  **Connect:** Click the extension icon and connect your Phantom wallet.
3.  **Verify:** The extension reads your wallet balance.
4.  **Activate:** If you hold 1,000 $WHALESHIELD, the **"WhaleShield Active"** status turns Green.
5.  **Browse:** Go to Pump.fun or X. The Shield is live.

---

## 🤝 Contributing

We welcome bug bounties (paid in $WHALESHIELD).

1.  Fork the Project
2.  Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3.  Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4.  Push to the Branch (`git push origin feature/AmazingFeature`)
5.  Open a Pull Request

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

## 👥 Contact

*   **Project Link:** [https://github.com/yourusername/WhaleShield](https://github.com/yourusername/WhaleShield)
*   **Twitter:** [@WhaleShield](https://twitter.com/WhaleShield)

**Built with ❤️ by the WhaleShield Protocol.**
