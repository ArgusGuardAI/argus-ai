# WhaleShield Browser Extension Submission Guide

## Quick Links

| Store | Developer Console | Fee | Review Time |
|-------|------------------|-----|-------------|
| Chrome | [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) | $5 one-time | 1-3 days |
| Firefox | [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/) | Free | 1-2 days |
| Edge | [Microsoft Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview) | Free | 3-7 days |

---

## Pre-Submission Checklist

### Files Ready
- [x] `build/chrome-mv3-prod.zip` (0.19 MB)
- [x] `build/firefox-mv3-prod.zip` (0.19 MB)
- [x] `build/edge-mv3-prod.zip` (0.19 MB)
- [x] `assets/icon128.png` (128x128 store icon)
- [x] `marketing/privacy-policy.html` (host at whaleshield.io/privacy)

### Required Before Submission
- [ ] Host privacy policy at `https://whaleshield.io/privacy`
- [ ] Take 3-5 screenshots (1280x800 recommended)
- [ ] Create promotional tile (440x280) - optional for Chrome

---

## Step 1: Chrome Web Store

### 1.1 Create Developer Account
1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Sign in with Google account
3. Pay $5 one-time registration fee
4. Accept Developer Agreement

### 1.2 Upload Extension
1. Click **"New Item"**
2. Upload `build/chrome-mv3-prod.zip`
3. Wait for upload to process

### 1.3 Fill Store Listing

**Short Description (max 132 chars):**
```
AI-powered security for Pump.fun. Detect honeypots, rug pulls, and scams before you trade. Protect your portfolio with WhaleShield.
```

**Detailed Description:**
```
WHALESHIELD - AI-Powered Rug Protection

WhaleShield is an AI-powered browser extension that protects you from scams on Pump.fun and Crypto Twitter.

FEATURES

- HONEYPOT DETECTION: AI analyzes smart contracts to detect hidden sell restrictions before you buy.
- RUG PULL ALERTS: Identifies dangerous holder concentrations and liquidity risks.
- DEPLOYER INTEL: Tracks wallet history to identify serial ruggers and known scammers.
- BUNDLE BOT DETECTION: Spots coordinated wallet activity and artificial buying pressure.
- COMMUNITY GRAFFITI: See warnings and insights from other traders in real-time.
- REAL-TIME ANALYSIS: Get instant risk scores on any Pump.fun token page.

HOW IT WORKS

1. Install WhaleShield
2. Visit any token on Pump.fun
3. See instant risk analysis overlay
4. Make informed trading decisions

PRIVACY

- No data collection
- No tracking
- Works locally in your browser
- Open source

$WHALESHIELD TOKEN

Hold 1,000 $WHALESHIELD tokens to unlock premium features including advanced AI analysis, community notes access, and priority support.

Stop getting rugged. Start trading smarter with WhaleShield.
```

**Category:** Productivity (or Finance if available)

**Language:** English

### 1.4 Upload Assets
- **Icon:** `assets/icon128.png`
- **Screenshots:** Upload 3-5 screenshots (1280x800)
- **Promotional Tile:** 440x280 (optional but recommended)

### 1.5 Privacy Tab
- **Privacy Policy URL:** `https://whaleshield.io/privacy`
- **Single Purpose:** "Analyzes cryptocurrency tokens for scam indicators"
- **Permissions Justification:**
  - `storage`: "Store user preferences locally"
  - `activeTab`: "Inject analysis overlay on token pages"
  - `host_permissions`: "Access pump.fun, twitter.com, x.com to inject security overlay"

### 1.6 Submit
1. Review all fields
2. Click **"Submit for Review"**
3. Wait 1-3 business days

---

## Step 2: Firefox Add-ons

### 2.1 Create Developer Account
1. Go to [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/)
2. Sign in with Firefox Account (or create one)
3. No fee required

### 2.2 Submit Add-on
1. Click **"Submit a New Add-on"**
2. Select **"On this site"** (for public listing)
3. Upload `build/firefox-mv3-prod.zip`
4. Wait for validation

### 2.3 Fill Listing Details

**Name:** WhaleShield

**Summary (max 250 chars):**
```
AI-powered security for Pump.fun. Detect honeypots, rug pulls, and scams before you trade. Real-time risk analysis powered by AI. Protect your crypto portfolio.
```

**Description:** (Same as Chrome detailed description)

**Categories:**
- Security
- Web Development (secondary)

**Tags:** `solana, crypto, security, pump.fun, trading, blockchain, defi, scam-detection`

**Support Email:** your-email@example.com

**Homepage:** `https://whaleshield.io`

### 2.4 Submit
1. Agree to policies
2. Click **"Submit Version"**
3. Wait 1-2 business days

---

## Step 3: Microsoft Edge Add-ons

### 3.1 Create Developer Account
1. Go to [Microsoft Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview)
2. Sign in with Microsoft account
3. Complete registration (no fee)

### 3.2 Submit Extension
1. Click **"Create new extension"**
2. Upload `build/edge-mv3-prod.zip`
3. Wait for package validation

### 3.3 Fill Store Listing

**Extension Name:** WhaleShield

**Short Description:**
```
AI-powered security extension that protects you from honeypots and rug pulls on Pump.fun.
```

**Description:** (Same as Chrome detailed description)

**Category:** Security

**Privacy Policy URL:** `https://whaleshield.io/privacy`

### 3.4 Upload Assets
- Screenshots (at least 1 required)
- Store icon uses the one in the package

### 3.5 Submit
1. Click **"Publish"**
2. Wait 3-7 business days

---

## Screenshot Suggestions

Take these 5 screenshots on pump.fun:

1. **Safe Token View**
   - Find a token with low risk score
   - Show green "SAFE" badge with the overlay expanded
   - Caption: "Instant AI-powered risk analysis"

2. **Dangerous Token Alert**
   - Find a token flagged as DANGEROUS or SCAM
   - Show red warning with risk flags visible
   - Caption: "Get warned before you buy"

3. **Risk Flags Expanded**
   - Show expanded view with multiple risk flags
   - Highlight the severity colors
   - Caption: "Detailed risk breakdown"

4. **Community Notes**
   - Show community graffiti notes
   - Caption: "Community-powered warnings"

5. **Before/After**
   - Side by side of pump.fun without and with WhaleShield
   - Caption: "Trade with confidence"

---

## After Submission

### If Rejected

**Common rejection reasons:**
1. **Permissions too broad** - Explain each permission in detail
2. **Missing privacy policy** - Ensure URL is accessible
3. **Misleading description** - Be accurate about features
4. **Broken functionality** - Test thoroughly before submitting

### Once Approved

1. Share store links on Twitter/X
2. Update website with install buttons
3. Add to README.md

---

## Support

- Twitter: [@WhaleShield](https://twitter.com/WhaleShield)
- Website: [whaleshield.io](https://whaleshield.io)
