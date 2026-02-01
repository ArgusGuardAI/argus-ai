import { useState, useEffect, useRef, useCallback } from 'react';

const styles = `
  /* ============================================
     ARGUS IMMERSIVE LANDING - THE WATCHER
     ============================================ */

  /* --- DESIGN TOKENS --- */
  .argus-landing {
    --bg-void: #020202;
    --bg-dark: #050505;
    --bg-card: #0A0A0C;
    --text-main: #F0F0F0;
    --text-muted: #8A8A95;
    --text-dim: #4A4A55;
    --accent: #DC2626;
    --accent-glow: rgba(220, 38, 38, 0.6);
    --accent-dim: rgba(220, 38, 38, 0.15);
    --purple: #7C3AED;
    --amber: #F59E0B;
    --emerald: #22C55E;
    --font-main: 'Inter', -apple-system, sans-serif;

    background: var(--bg-void);
    color: var(--text-main);
    font-family: var(--font-main);
    min-height: 100vh;
    overflow-x: hidden;
    -webkit-font-smoothing: antialiased;
  }

  .argus-landing * { box-sizing: border-box; }

  /* ============================================
     INTRO SCREEN - THE EYE
     ============================================ */
  .intro-screen {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: var(--bg-void);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    cursor: pointer;
    transition: opacity 0.8s ease, transform 1.2s ease;
  }

  .intro-screen.diving {
    opacity: 0;
    transform: scale(3);
  }

  .intro-screen.hidden {
    display: none;
  }

  .intro-content {
    text-align: center;
    transform: translateY(-20px);
  }

  .intro-hint {
    position: absolute;
    bottom: 60px;
    left: 50%;
    transform: translateX(-50%);
    color: var(--text-muted);
    font-size: 0.85rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    animation: pulse-hint 2s ease-in-out infinite;
  }

  @keyframes pulse-hint {
    0%, 100% { opacity: 0.5; }
    50% { opacity: 1; }
  }

  /* The Argus Eye SVG */
  .argus-eye {
    width: 200px;
    height: 200px;
    filter: drop-shadow(0 0 60px var(--accent-glow)) drop-shadow(0 0 120px var(--accent-dim));
    animation: eye-pulse 3s ease-in-out infinite, eye-float 6s ease-in-out infinite;
    transition: transform 0.3s ease, filter 0.3s ease;
  }

  .argus-eye:hover {
    transform: scale(1.1);
    filter: drop-shadow(0 0 80px var(--accent-glow)) drop-shadow(0 0 160px rgba(220, 38, 38, 0.3));
  }

  @keyframes eye-pulse {
    0%, 100% {
      filter: drop-shadow(0 0 60px var(--accent-glow)) drop-shadow(0 0 120px var(--accent-dim));
    }
    50% {
      filter: drop-shadow(0 0 100px var(--accent-glow)) drop-shadow(0 0 200px rgba(220, 38, 38, 0.4));
    }
  }

  @keyframes eye-float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-10px); }
  }

  .intro-title {
    margin-top: 40px;
    font-size: 1rem;
    letter-spacing: 0.4em;
    text-transform: uppercase;
    color: var(--text-muted);
    font-weight: 400;
  }

  /* Particles around the eye */
  .intro-particles {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    overflow: hidden;
  }

  .particle {
    position: absolute;
    width: 2px;
    height: 2px;
    background: var(--accent);
    border-radius: 50%;
    opacity: 0;
    animation: particle-drift 8s linear infinite;
  }

  @keyframes particle-drift {
    0% {
      opacity: 0;
      transform: translateY(100vh) scale(0);
    }
    10% {
      opacity: 0.6;
    }
    90% {
      opacity: 0.6;
    }
    100% {
      opacity: 0;
      transform: translateY(-100px) scale(1);
    }
  }

  /* ============================================
     MAIN JOURNEY
     ============================================ */
  .journey {
    opacity: 0;
    transition: opacity 1s ease 0.5s;
  }

  .journey.visible {
    opacity: 1;
  }

  /* Narrative sections */
  .narrative-section {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    padding: 60px 24px;
  }

  .narrative-content {
    max-width: 900px;
    text-align: center;
    opacity: 0;
    transform: translateY(60px);
    transition: opacity 0.8s ease, transform 0.8s ease;
  }

  .narrative-content.visible {
    opacity: 1;
    transform: translateY(0);
  }

  .narrative-label {
    font-size: 0.75rem;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: 24px;
    font-weight: 500;
  }

  .narrative-title {
    font-size: clamp(2rem, 6vw, 4rem);
    font-weight: 700;
    line-height: 1.1;
    margin-bottom: 24px;
    background: linear-gradient(180deg, var(--text-main) 0%, var(--text-muted) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .narrative-title span {
    background: linear-gradient(135deg, var(--accent) 0%, #EF4444 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .narrative-text {
    font-size: 1.15rem;
    line-height: 1.8;
    color: var(--text-muted);
    max-width: 600px;
    margin: 0 auto;
  }

  /* Section: The Darkness */
  .section-darkness {
    background:
      radial-gradient(ellipse at 50% 100%, rgba(220, 38, 38, 0.05) 0%, transparent 50%),
      var(--bg-void);
  }

  .darkness-stats {
    display: flex;
    justify-content: center;
    gap: 60px;
    margin-top: 60px;
    flex-wrap: wrap;
  }

  .darkness-stat {
    text-align: center;
  }

  .darkness-stat-value {
    font-size: 3rem;
    font-weight: 800;
    color: var(--accent);
    line-height: 1;
  }

  .darkness-stat-label {
    font-size: 0.8rem;
    color: var(--text-dim);
    margin-top: 8px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  /* Section: The Awakening */
  .section-awakening {
    background:
      radial-gradient(ellipse at 50% 0%, rgba(220, 38, 38, 0.08) 0%, transparent 60%),
      var(--bg-void);
  }

  .awakening-eye {
    width: 120px;
    height: 120px;
    margin: 0 auto 40px;
    filter: drop-shadow(0 0 40px var(--accent-glow));
    animation: awakening-glow 2s ease-in-out infinite;
  }

  @keyframes awakening-glow {
    0%, 100% { filter: drop-shadow(0 0 40px var(--accent-glow)); }
    50% { filter: drop-shadow(0 0 80px var(--accent-glow)); }
  }

  /* Section: The Swarm (Agents) */
  .section-swarm {
    background: var(--bg-void);
    padding: 120px 24px;
  }

  .agents-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 24px;
    margin-top: 60px;
    max-width: 1200px;
    margin-left: auto;
    margin-right: auto;
  }

  .agent-card {
    background: var(--bg-card);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 16px;
    padding: 32px;
    text-align: left;
    opacity: 0;
    transform: translateY(40px);
    transition: opacity 0.6s ease, transform 0.6s ease, border-color 0.3s ease, box-shadow 0.3s ease;
  }

  .agent-card.visible {
    opacity: 1;
    transform: translateY(0);
  }

  .agent-card:hover {
    border-color: rgba(255, 255, 255, 0.1);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }

  .agent-card:nth-child(1) { transition-delay: 0.1s; }
  .agent-card:nth-child(2) { transition-delay: 0.2s; }
  .agent-card:nth-child(3) { transition-delay: 0.3s; }
  .agent-card:nth-child(4) { transition-delay: 0.4s; }

  .agent-icon {
    width: 60px;
    height: 60px;
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 20px;
    font-size: 1.5rem;
    color: white;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  }

  .agent-icon.scout { background: linear-gradient(135deg, var(--purple) 0%, #5B21B6 100%); box-shadow: 0 4px 20px rgba(139, 92, 246, 0.3); }
  .agent-icon.analyst { background: linear-gradient(135deg, var(--accent) 0%, #991B1B 100%); box-shadow: 0 4px 20px rgba(220, 38, 38, 0.3); }
  .agent-icon.hunter { background: linear-gradient(135deg, var(--amber) 0%, #D97706 100%); box-shadow: 0 4px 20px rgba(245, 158, 11, 0.3); }
  .agent-icon.trader { background: linear-gradient(135deg, var(--emerald) 0%, #16A34A 100%); box-shadow: 0 4px 20px rgba(16, 185, 129, 0.3); }

  .agent-name {
    font-size: 1.25rem;
    font-weight: 700;
    margin-bottom: 8px;
    color: var(--text-main);
  }

  .agent-role {
    font-size: 0.8rem;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 16px;
  }

  .agent-desc {
    font-size: 0.95rem;
    color: var(--text-muted);
    line-height: 1.6;
  }

  /* Section: The Hunt (How it works) */
  .section-hunt {
    background:
      radial-gradient(ellipse at 30% 50%, rgba(124, 58, 237, 0.05) 0%, transparent 50%),
      radial-gradient(ellipse at 70% 50%, rgba(220, 38, 38, 0.05) 0%, transparent 50%),
      var(--bg-void);
  }

  .hunt-steps {
    display: flex;
    flex-direction: column;
    gap: 40px;
    margin-top: 60px;
    max-width: 700px;
    margin-left: auto;
    margin-right: auto;
  }

  .hunt-step {
    display: flex;
    align-items: flex-start;
    gap: 24px;
    text-align: left;
    opacity: 0;
    transform: translateX(-40px);
    transition: opacity 0.6s ease, transform 0.6s ease;
  }

  .hunt-step.visible {
    opacity: 1;
    transform: translateX(0);
  }

  .hunt-step:nth-child(1) { transition-delay: 0.1s; }
  .hunt-step:nth-child(2) { transition-delay: 0.2s; }
  .hunt-step:nth-child(3) { transition-delay: 0.3s; }
  .hunt-step:nth-child(4) { transition-delay: 0.4s; }

  .hunt-step-num {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: var(--accent);
    color: white;
    font-weight: 700;
    font-size: 1.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    box-shadow: 0 0 30px var(--accent-dim);
  }

  .hunt-step-content h4 {
    font-size: 1.1rem;
    font-weight: 600;
    margin-bottom: 8px;
    color: var(--text-main);
  }

  .hunt-step-content p {
    font-size: 0.95rem;
    color: var(--text-muted);
    line-height: 1.6;
  }

  /* Section: The Arsenal (Features) */
  .section-arsenal {
    background: var(--bg-dark);
    padding: 120px 24px;
  }

  .arsenal-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    margin-top: 60px;
    max-width: 1000px;
    margin-left: auto;
    margin-right: auto;
  }

  @media (max-width: 900px) {
    .arsenal-grid { grid-template-columns: repeat(2, 1fr); }
  }

  @media (max-width: 600px) {
    .arsenal-grid { grid-template-columns: 1fr; }
  }

  .arsenal-item {
    background: var(--bg-card);
    border: 1px solid rgba(255, 255, 255, 0.03);
    border-radius: 12px;
    padding: 24px;
    opacity: 0;
    transform: scale(0.95);
    transition: opacity 0.5s ease, transform 0.5s ease, border-color 0.3s ease;
  }

  .arsenal-item.visible {
    opacity: 1;
    transform: scale(1);
  }

  .arsenal-item:hover {
    border-color: rgba(220, 38, 38, 0.3);
  }

  .arsenal-item h5 {
    font-size: 0.95rem;
    font-weight: 600;
    margin-bottom: 8px;
    color: var(--text-main);
  }

  .arsenal-item p {
    font-size: 0.85rem;
    color: var(--text-muted);
    line-height: 1.5;
  }

  /* Section: The Compression Engine */
  .section-engine {
    background:
      radial-gradient(ellipse at 50% 100%, rgba(220, 38, 38, 0.1) 0%, transparent 50%),
      var(--bg-void);
    padding: 120px 24px;
  }

  .engine-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 24px;
    margin-top: 60px;
    max-width: 900px;
    margin-left: auto;
    margin-right: auto;
  }

  @media (max-width: 700px) {
    .engine-stats { grid-template-columns: repeat(2, 1fr); }
  }

  .engine-stat {
    text-align: center;
    padding: 32px 16px;
    background: var(--bg-card);
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.03);
    opacity: 0;
    transform: translateY(30px);
    transition: opacity 0.5s ease, transform 0.5s ease;
  }

  .engine-stat.visible {
    opacity: 1;
    transform: translateY(0);
  }

  .engine-stat-value {
    font-size: 2.5rem;
    font-weight: 800;
    background: linear-gradient(135deg, var(--accent) 0%, #EF4444 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    line-height: 1;
    margin-bottom: 8px;
  }

  .engine-stat-label {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  /* Section: Pricing */
  .section-pricing {
    background: var(--bg-dark);
    padding: 120px 24px;
  }

  .pricing-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 24px;
    margin-top: 60px;
    max-width: 1000px;
    margin-left: auto;
    margin-right: auto;
  }

  @media (max-width: 900px) {
    .pricing-grid { grid-template-columns: 1fr; max-width: 400px; }
  }

  .pricing-card {
    background: var(--bg-card);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 16px;
    padding: 32px;
    text-align: center;
    opacity: 0;
    transform: translateY(30px);
    transition: opacity 0.5s ease, transform 0.5s ease, border-color 0.3s ease;
  }

  .pricing-card.visible {
    opacity: 1;
    transform: translateY(0);
  }

  .pricing-card:nth-child(1) { transition-delay: 0.1s; }
  .pricing-card:nth-child(2) { transition-delay: 0.2s; }
  .pricing-card:nth-child(3) { transition-delay: 0.3s; }

  .pricing-card.featured {
    border-color: var(--accent);
    box-shadow: 0 0 40px var(--accent-dim);
    position: relative;
  }

  .pricing-card.featured::before {
    content: 'RECOMMENDED';
    position: absolute;
    top: -12px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--accent);
    color: white;
    font-size: 0.65rem;
    font-weight: 700;
    padding: 4px 12px;
    border-radius: 4px;
    letter-spacing: 0.1em;
  }

  .pricing-tier {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: var(--text-dim);
    margin-bottom: 16px;
  }

  .pricing-price {
    font-size: 2.5rem;
    font-weight: 800;
    color: var(--text-main);
    line-height: 1;
    margin-bottom: 8px;
  }

  .pricing-price span {
    font-size: 1rem;
    font-weight: 400;
    color: var(--text-muted);
  }

  .pricing-desc {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin-bottom: 24px;
  }

  .pricing-features {
    text-align: left;
    margin-bottom: 24px;
  }

  .pricing-features li {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.9rem;
    color: var(--text-muted);
    padding: 8px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  }

  .pricing-features li:last-child {
    border-bottom: none;
  }

  .pricing-features .check {
    color: var(--emerald);
    font-size: 0.8rem;
  }

  .pricing-features .limit {
    color: var(--text-dim);
  }

  .pricing-cta {
    display: block;
    padding: 14px 24px;
    border-radius: 10px;
    font-size: 0.9rem;
    font-weight: 600;
    text-decoration: none;
    transition: all 0.2s ease;
  }

  .pricing-cta-primary {
    background: linear-gradient(135deg, var(--accent) 0%, #991B1B 100%);
    color: white;
  }

  .pricing-cta-primary:hover {
    box-shadow: 0 4px 20px var(--accent-dim);
    transform: translateY(-2px);
  }

  .pricing-cta-outline {
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: var(--text-muted);
  }

  .pricing-cta-outline:hover {
    border-color: var(--accent);
    color: var(--text-main);
  }

  /* Section: Token */
  .section-token {
    background:
      radial-gradient(ellipse at 50% 30%, rgba(220, 38, 38, 0.12) 0%, transparent 60%),
      var(--bg-void);
    padding: 120px 24px;
  }

  .section-token .narrative-content {
    margin-bottom: 20px;
  }

  .token-card {
    max-width: 500px;
    margin: 40px auto 0;
    background: linear-gradient(180deg, rgba(30, 30, 35, 0.9) 0%, rgba(20, 20, 25, 0.95) 100%);
    border: 2px solid rgba(220, 38, 38, 0.3);
    border-radius: 24px;
    padding: 48px 40px;
    text-align: center;
    box-shadow:
      0 0 80px rgba(220, 38, 38, 0.15),
      0 0 40px rgba(220, 38, 38, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 0.05);
    position: relative;
    overflow: hidden;
  }

  .token-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 60%;
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--accent), transparent);
  }

  .token-symbol {
    font-size: 3.5rem;
    font-weight: 800;
    background: linear-gradient(135deg, var(--accent) 0%, #EF4444 50%, var(--accent) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    margin-bottom: 8px;
    text-shadow: 0 0 40px var(--accent-dim);
  }

  .token-name {
    font-size: 1.1rem;
    color: var(--text-muted);
    margin-bottom: 36px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .token-ca {
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    padding: 16px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 32px;
  }

  .token-ca-label {
    font-size: 0.7rem;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .token-ca-address {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.85rem;
    color: var(--text-main);
    word-break: break-all;
  }

  .token-ca-copy {
    background: var(--accent);
    border: none;
    border-radius: 8px;
    padding: 8px 16px;
    color: white;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
  }

  .token-ca-copy:hover {
    background: #EF4444;
    transform: scale(1.05);
  }

  .token-ca-copy.copied {
    background: var(--emerald);
  }

  .token-links {
    display: flex;
    gap: 16px;
    justify-content: center;
    flex-wrap: wrap;
  }

  .token-link {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 24px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    color: var(--text-main);
    font-size: 0.9rem;
    font-weight: 500;
    text-decoration: none;
    transition: all 0.2s ease;
  }

  .token-link:hover {
    border-color: var(--accent);
    background: rgba(220, 38, 38, 0.1);
    transform: translateY(-2px);
  }

  .token-link i {
    font-size: 1.1rem;
    color: var(--accent);
  }

  /* Section: Roadmap */
  .section-roadmap {
    background: var(--bg-dark);
    padding: 120px 24px;
  }

  .roadmap-timeline {
    max-width: 900px;
    margin: 60px auto 0;
    position: relative;
  }

  .roadmap-timeline::before {
    content: '';
    position: absolute;
    left: 50%;
    top: 24px;
    bottom: 24px;
    width: 3px;
    background: linear-gradient(180deg, var(--accent) 0%, var(--accent-dim) 50%, rgba(220, 38, 38, 0.1) 100%);
    transform: translateX(-50%);
    box-shadow: 0 0 15px var(--accent-dim);
  }

  @media (max-width: 700px) {
    .roadmap-timeline::before {
      left: 24px;
    }
  }

  .roadmap-phase {
    display: flex;
    align-items: flex-start;
    margin-bottom: 70px;
    opacity: 0;
    transform: translateY(30px);
    transition: opacity 0.6s ease, transform 0.6s ease;
  }

  .roadmap-phase:last-child {
    margin-bottom: 0;
  }

  .roadmap-phase.visible {
    opacity: 1;
    transform: translateY(0);
  }

  .roadmap-phase:nth-child(odd) {
    flex-direction: row;
    text-align: right;
  }

  .roadmap-phase:nth-child(even) {
    flex-direction: row-reverse;
    text-align: left;
  }

  @media (max-width: 700px) {
    .roadmap-phase:nth-child(odd),
    .roadmap-phase:nth-child(even) {
      flex-direction: row;
      text-align: left;
    }
  }

  .roadmap-content {
    flex: 1;
    padding: 0 50px;
    background: rgba(20, 20, 25, 0.5);
    border-radius: 16px;
    padding: 24px 32px;
    border: 1px solid rgba(220, 38, 38, 0.1);
  }

  @media (max-width: 700px) {
    .roadmap-content {
      padding: 20px 24px;
      margin-left: 20px;
    }
  }

  .roadmap-marker {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: var(--bg-card);
    border: 3px solid var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    position: relative;
    z-index: 1;
    box-shadow: 0 0 25px var(--accent-dim), 0 0 50px rgba(220, 38, 38, 0.1);
    transition: transform 0.3s ease, box-shadow 0.3s ease;
  }

  .roadmap-marker:hover {
    transform: scale(1.1);
    box-shadow: 0 0 35px var(--accent-dim), 0 0 60px rgba(220, 38, 38, 0.2);
  }

  .roadmap-marker.completed {
    background: var(--accent);
    box-shadow: 0 0 30px var(--accent-dim), 0 0 60px rgba(220, 38, 38, 0.3);
  }

  .roadmap-marker.completed i {
    color: white;
  }

  .roadmap-marker.current {
    animation: pulse-marker 2s ease-in-out infinite;
  }

  @keyframes pulse-marker {
    0%, 100% { box-shadow: 0 0 20px var(--accent-dim); }
    50% { box-shadow: 0 0 40px var(--accent-glow); }
  }

  .roadmap-marker i {
    font-size: 1.2rem;
    color: var(--accent);
  }

  .roadmap-phase-label {
    font-size: 0.75rem;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.15em;
    font-weight: 600;
    margin-bottom: 8px;
  }

  .roadmap-phase-title {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text-main);
    margin-bottom: 12px;
  }

  .roadmap-items {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .roadmap-items li {
    font-size: 0.9rem;
    color: var(--text-muted);
    padding: 6px 0;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .roadmap-phase:nth-child(odd) .roadmap-items li {
    justify-content: flex-end;
  }

  @media (max-width: 700px) {
    .roadmap-phase:nth-child(odd) .roadmap-items li {
      justify-content: flex-start;
    }
  }

  .roadmap-items li i {
    font-size: 0.7rem;
    width: 16px;
    text-align: center;
  }

  .roadmap-items li i.done {
    color: var(--emerald);
  }

  .roadmap-items li i.progress {
    color: var(--amber);
  }

  .roadmap-items li i.pending {
    color: var(--text-dim);
    font-size: 0.5rem;
  }

  /* Section: Final Chapter - The Global Network */
  .section-network {
    background: var(--bg-void);
    padding: 120px 24px;
    text-align: center;
    position: relative;
    overflow: hidden;
    min-height: 100vh;
  }

  .network-globe-container {
    position: relative;
    width: 100%;
    max-width: 900px;
    height: 550px;
    margin: 60px auto 40px;
    background:
      radial-gradient(ellipse at center, rgba(220, 38, 38, 0.03) 0%, transparent 70%);
    contain: layout style paint;
    will-change: contents;
  }

  /* World map - dark fill with glowing red outline */
  .world-map {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 90%;
    height: auto;
    opacity: 0.6;
    filter: brightness(0.15) sepia(1) hue-rotate(-50deg) saturate(3) drop-shadow(0 0 8px rgba(220, 38, 38, 0.8)) drop-shadow(0 0 20px rgba(220, 38, 38, 0.4));
    pointer-events: none;
  }

  /* Scanning grid overlay */
  .scan-grid {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-image:
      linear-gradient(rgba(220, 38, 38, 0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(220, 38, 38, 0.03) 1px, transparent 1px);
    background-size: 40px 40px;
    animation: grid-scan 8s linear infinite;
    animation-fill-mode: both;
    will-change: background-position;
    backface-visibility: hidden;
  }

  @keyframes grid-scan {
    0% { background-position: 0 0; }
    100% { background-position: 40px 40px; }
  }

  /* Network nodes - Triangle style (Argus eye aesthetic) */
  .network-node {
    position: absolute;
    width: 0;
    height: 0;
    border-left: 10px solid transparent;
    border-right: 10px solid transparent;
    border-bottom: 18px solid var(--accent);
    background: transparent;
    filter: drop-shadow(0 0 10px var(--accent)) drop-shadow(0 0 20px var(--accent));
    animation: node-pulse-war 1.5s ease-in-out infinite;
    animation-fill-mode: both;
    will-change: transform, filter;
    backface-visibility: hidden;
    z-index: 10;
  }

  .network-node::before {
    content: '';
    position: absolute;
    top: 6px;
    left: -16px;
    width: 0;
    height: 0;
    border-left: 16px solid transparent;
    border-right: 16px solid transparent;
    border-bottom: 28px solid transparent;
    border-bottom-color: rgba(220, 38, 38, 0.3);
    opacity: 0;
    animation: triangle-ring 2s ease-out infinite;
    animation-fill-mode: both;
    will-change: transform, opacity;
  }

  .network-node::after {
    content: '';
    position: absolute;
    top: 6px;
    left: -22px;
    width: 0;
    height: 0;
    border-left: 22px solid transparent;
    border-right: 22px solid transparent;
    border-bottom: 38px solid transparent;
    border-bottom-color: rgba(220, 38, 38, 0.15);
    opacity: 0;
    animation-fill-mode: both;
    will-change: transform, opacity;
    animation: triangle-ring 2s ease-out infinite 0.5s;
  }

  .network-node.core {
    border-left: 14px solid transparent;
    border-right: 14px solid transparent;
    border-bottom: 24px solid var(--accent);
    filter:
      drop-shadow(0 0 15px var(--accent))
      drop-shadow(0 0 30px var(--accent))
      drop-shadow(0 0 60px rgba(220, 38, 38, 0.8));
  }

  .network-node.threat {
    border-bottom-color: var(--amber);
    filter: drop-shadow(0 0 10px var(--amber)) drop-shadow(0 0 20px var(--amber));
    animation: threat-blink 0.5s ease-in-out infinite;
    animation-fill-mode: both;
  }

  @keyframes node-pulse-war {
    0%, 100% { transform: scale(1); filter: drop-shadow(0 0 10px var(--accent)) drop-shadow(0 0 20px var(--accent)); }
    50% { transform: scale(1.2); filter: drop-shadow(0 0 20px var(--accent)) drop-shadow(0 0 40px var(--accent)); }
  }

  @keyframes triangle-ring {
    0% { transform: scale(0.5); opacity: 0.8; }
    100% { transform: scale(2); opacity: 0; }
  }

  @keyframes threat-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  /* Laser beams - aggressive */
  .laser-beam {
    position: absolute;
    height: 3px;
    background: linear-gradient(90deg,
      transparent 0%,
      rgba(220, 38, 38, 0.3) 10%,
      var(--accent) 50%,
      rgba(220, 38, 38, 0.3) 90%,
      transparent 100%);
    transform-origin: left center;
    box-shadow: 0 0 10px var(--accent), 0 0 20px rgba(220, 38, 38, 0.5);
    animation: laser-fire 2s ease-in-out infinite;
    animation-fill-mode: both;
    will-change: clip-path, opacity;
    backface-visibility: hidden;
    z-index: 5;
  }

  .laser-beam::before {
    content: '';
    position: absolute;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 8px;
    height: 8px;
    background: white;
    border-radius: 50%;
    box-shadow: 0 0 15px var(--accent), 0 0 30px var(--accent);
    animation: packet-glow 0.3s ease-in-out infinite;
    animation-fill-mode: both;
    will-change: opacity;
  }

  @keyframes laser-fire {
    0% {
      clip-path: inset(0 100% 0 0);
      opacity: 0;
    }
    10% { opacity: 1; }
    50% {
      clip-path: inset(0 0 0 0);
    }
    90% { opacity: 1; }
    100% {
      clip-path: inset(0 0 0 100%);
      opacity: 0;
    }
  }

  @keyframes packet-glow {
    0%, 100% { box-shadow: 0 0 15px var(--accent), 0 0 30px var(--accent); }
    50% { box-shadow: 0 0 25px white, 0 0 50px var(--accent); }
  }

  /* Threat indicators */
  .threat-indicator {
    position: absolute;
    padding: 4px 8px;
    background: rgba(0, 0, 0, 0.8);
    border: 1px solid var(--accent);
    border-radius: 4px;
    font-size: 0.65rem;
    font-family: 'JetBrains Mono', monospace;
    color: var(--accent);
    white-space: nowrap;
    animation: threat-popup 3s ease-in-out infinite;
    z-index: 20;
  }

  @keyframes threat-popup {
    0%, 100% { opacity: 0; transform: translateY(10px); }
    20%, 80% { opacity: 1; transform: translateY(0); }
  }

  /* Network stats overlay */
  .network-stats {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 60px;
    justify-content: center;
    flex-wrap: wrap;
    background: rgba(0, 0, 0, 0.6);
    padding: 16px 32px;
    border-radius: 12px;
    border: 1px solid rgba(220, 38, 38, 0.2);
  }

  .network-stat {
    text-align: center;
  }

  .network-stat-value {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--accent);
    font-family: 'JetBrains Mono', monospace;
    text-shadow: 0 0 20px var(--accent);
  }

  .network-stat-value.live {
    animation: value-pulse 1s ease-in-out infinite;
  }

  @keyframes value-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }

  .network-stat-label {
    font-size: 0.7rem;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .join-eye {
    width: 100px;
    height: 100px;
    margin: 0 auto 40px;
    filter: drop-shadow(0 0 40px var(--accent-glow));
    animation: awakening-glow 2s ease-in-out infinite;
  }

  .join-cta {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 22px 64px;
    background: linear-gradient(135deg, var(--accent) 0%, #B91C1C 50%, var(--accent) 100%);
    background-size: 200% 100%;
    color: white;
    font-size: 1.2rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    border-radius: 14px;
    margin-top: 40px;
    cursor: pointer;
    transition: transform 0.3s ease, box-shadow 0.3s ease, background-position 0.5s ease;
    text-decoration: none;
    box-shadow:
      0 4px 30px var(--accent-dim),
      0 0 60px rgba(220, 38, 38, 0.3),
      inset 0 1px 0 rgba(255, 255, 255, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.1);
    position: relative;
    overflow: hidden;
  }

  .join-cta::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
    animation: cta-shimmer 3s ease-in-out infinite;
  }

  @keyframes cta-shimmer {
    0%, 100% { left: -100%; }
    50% { left: 100%; }
  }

  .join-cta:hover {
    transform: translateY(-4px) scale(1.02);
    box-shadow:
      0 8px 50px var(--accent-glow),
      0 0 80px rgba(220, 38, 38, 0.4);
    background-position: 100% 0;
  }

  .join-secondary {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 16px 32px;
    background: rgba(220, 38, 38, 0.05);
    color: var(--text-muted);
    font-size: 0.95rem;
    font-weight: 500;
    border: 1px solid rgba(220, 38, 38, 0.2);
    border-radius: 12px;
    margin-top: 16px;
    margin-left: 16px;
    cursor: pointer;
    transition: all 0.3s ease;
    text-decoration: none;
  }

  .join-secondary:hover {
    border-color: var(--accent);
    color: var(--text-main);
    background: rgba(220, 38, 38, 0.1);
    transform: translateY(-2px);
  }

  /* Footer */
  .landing-footer {
    background: var(--bg-dark);
    border-top: 1px solid rgba(255, 255, 255, 0.03);
    padding: 40px 24px;
    text-align: center;
  }

  .footer-links {
    display: flex;
    justify-content: center;
    gap: 32px;
    flex-wrap: wrap;
    margin-bottom: 24px;
  }

  .footer-links a {
    color: var(--text-muted);
    font-size: 0.85rem;
    text-decoration: none;
    transition: color 0.2s ease;
  }

  .footer-links a:hover {
    color: var(--text-main);
  }

  .footer-copy {
    font-size: 0.8rem;
    color: var(--text-dim);
  }

  /* Scroll indicator */
  .scroll-indicator {
    position: fixed;
    bottom: 30px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 100;
    opacity: 0;
    transition: opacity 0.3s ease;
    pointer-events: none;
  }

  .scroll-indicator.visible {
    opacity: 1;
  }

  .scroll-indicator svg {
    width: 24px;
    height: 24px;
    color: var(--text-dim);
    animation: scroll-bounce 2s ease-in-out infinite;
  }

  @keyframes scroll-bounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(8px); }
  }

  /* Terminal preview */
  .terminal-preview {
    background: #0A0A0C;
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    overflow: hidden;
    max-width: 700px;
    margin: 60px auto 0;
    text-align: left;
  }

  .terminal-header {
    background: rgba(255, 255, 255, 0.03);
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .terminal-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
  }

  .terminal-dot.red { background: #EF4444; }
  .terminal-dot.yellow { background: #F59E0B; }
  .terminal-dot.green { background: #22C55E; }

  .terminal-title {
    margin-left: 12px;
    font-size: 0.75rem;
    color: var(--text-dim);
  }

  .terminal-body {
    padding: 20px;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 0.8rem;
    line-height: 1.8;
  }

  .terminal-line {
    opacity: 0;
    transform: translateY(10px);
    transition: opacity 0.3s ease, transform 0.3s ease;
  }

  .terminal-line.visible {
    opacity: 1;
    transform: translateY(0);
  }

  .terminal-line .dim { color: var(--text-dim); }
  .terminal-line .white { color: var(--text-main); }
  .terminal-line .red { color: #EF4444; }
  .terminal-line .amber { color: #F59E0B; }
  .terminal-line .purple { color: #A78BFA; }
  .terminal-line .green { color: #22C55E; }
  .terminal-line .cyan { color: #22D3EE; }

  /* Responsive */
  @media (max-width: 768px) {
    .darkness-stats { gap: 40px; }
    .darkness-stat-value { font-size: 2.5rem; }
    .agents-grid { grid-template-columns: 1fr; }
    .hunt-step { flex-direction: column; text-align: center; }
    .hunt-step-num { margin: 0 auto; }
    .engine-stats { grid-template-columns: repeat(2, 1fr); gap: 16px; }
    .engine-stat-value { font-size: 2rem; }
    .join-cta, .join-secondary { display: block; width: 100%; max-width: 300px; margin: 16px auto 0; }
  }
`;

// Argus Eye SVG Component
const ArgusEye = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Outer triangle */}
    <path
      d="M50 8L92 85H8L50 8Z"
      stroke="#DC2626"
      strokeWidth="1.5"
      fill="none"
      opacity="0.8"
    />
    {/* Inner triangle glow */}
    <path
      d="M50 20L80 75H20L50 20Z"
      stroke="#DC2626"
      strokeWidth="0.5"
      fill="none"
      opacity="0.4"
    />
    {/* Eye outer */}
    <ellipse
      cx="50"
      cy="50"
      rx="22"
      ry="12"
      stroke="#DC2626"
      strokeWidth="1.5"
      fill="none"
    />
    {/* Eye inner glow */}
    <ellipse
      cx="50"
      cy="50"
      rx="18"
      ry="9"
      fill="rgba(220, 38, 38, 0.1)"
    />
    {/* Pupil */}
    <circle
      cx="50"
      cy="50"
      r="8"
      fill="#DC2626"
    />
    {/* Pupil inner */}
    <circle
      cx="50"
      cy="50"
      r="4"
      fill="#0A0A0A"
    />
    {/* Highlight */}
    <circle
      cx="47"
      cy="48"
      r="2"
      fill="rgba(255, 255, 255, 0.6)"
    />
  </svg>
);

export default function Landing() {
  // Intro state
  const [introVisible, setIntroVisible] = useState(true);
  const [introDiving, setIntroDiving] = useState(false);
  const [journeyVisible, setJourneyVisible] = useState(false);

  // Section visibility
  const [visibleSections, setVisibleSections] = useState<Set<string>>(new Set());
  const sectionRefs = useRef<{ [key: string]: HTMLElement | null }>({});

  // Terminal animation
  const [terminalLines, setTerminalLines] = useState(0);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Token copy state
  const [copied, setCopied] = useState(false);

  // Token contract address - PLACEHOLDER until official launch
  const TOKEN_CA = 'COMING_SOON';

  // Handle intro click
  const handleIntroClick = useCallback(() => {
    setIntroDiving(true);
    setTimeout(() => {
      setIntroVisible(false);
      setJourneyVisible(true);
    }, 1000);
  }, []);

  // Copy token address
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(TOKEN_CA);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  // Intersection observer for sections
  useEffect(() => {
    if (!journeyVisible) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisibleSections((prev) => new Set([...prev, entry.target.id]));
          }
        });
      },
      { threshold: 0.2 }
    );

    Object.values(sectionRefs.current).forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => observer.disconnect();
  }, [journeyVisible]);

  // Terminal animation
  useEffect(() => {
    if (!visibleSections.has('hunt')) return;

    const interval = setInterval(() => {
      setTerminalLines((prev) => {
        if (prev >= 8) {
          clearInterval(interval);
          return prev;
        }
        return prev + 1;
      });
    }, 400);

    return () => clearInterval(interval);
  }, [visibleSections]);

  const terminalContent = [
    { text: '$ argus hunt 7xKp...pump', class: 'white' },
    { text: '[SCOUT-1] Target acquired. Scanning mempool...', class: 'purple' },
    { text: '[ANALYST-1] Compressing 2.1MB → 116 bytes', class: 'cyan' },
    { text: '[ANALYST-1] Pattern: BUNDLE_COORDINATOR (87%)', class: 'amber' },
    { text: '[HUNTER-1] WARNING: 3 wallets linked to previous rug', class: 'red' },
    { text: '[HUNTER-1] Syndicate network: 8 tokens, 75% rug rate', class: 'red' },
    { text: '[TRADER-1] Auto-exit engaged. Position protected.', class: 'green' },
    { text: '[ARGUS] The shadows remember. Target flagged.', class: 'dim' },
  ];

  // Generate particles
  const particles = Array.from({ length: 30 }, () => ({
    left: `${Math.random() * 100}%`,
    animationDelay: `${Math.random() * 8}s`,
    animationDuration: `${6 + Math.random() * 4}s`,
  }));

  // Network nodes - FULL GLOBAL COVERAGE
  const networkNodes = [
    // North America
    { id: 0, x: 15, y: 28, label: 'NA-W', type: 'agent' },
    { id: 1, x: 22, y: 32, label: 'NA-C', type: 'agent' },
    { id: 2, x: 28, y: 35, label: 'NA-E', type: 'agent' },
    // South America
    { id: 3, x: 28, y: 55, label: 'SA-N', type: 'agent' },
    { id: 4, x: 30, y: 65, label: 'SA-S', type: 'agent' },
    // Europe
    { id: 5, x: 45, y: 25, label: 'EU-N', type: 'agent' },
    { id: 6, x: 48, y: 32, label: 'EU-C', type: 'agent' },
    { id: 7, x: 52, y: 35, label: 'EU-S', type: 'agent' },
    // Africa
    { id: 8, x: 48, y: 45, label: 'AF-N', type: 'threat' },
    { id: 9, x: 52, y: 55, label: 'AF-S', type: 'threat' },
    // Middle East - CORE
    { id: 10, x: 58, y: 38, label: 'CORE', type: 'core' },
    // Asia
    { id: 11, x: 65, y: 28, label: 'AS-W', type: 'agent' },
    { id: 12, x: 72, y: 32, label: 'AS-C', type: 'agent' },
    { id: 13, x: 80, y: 30, label: 'AS-E', type: 'agent' },
    // Southeast Asia
    { id: 14, x: 75, y: 48, label: 'SEA', type: 'agent' },
    // Australia
    { id: 15, x: 82, y: 60, label: 'OC', type: 'agent' },
    // Antarctica
    { id: 16, x: 40, y: 78, label: 'ANT-W', type: 'agent' },
    { id: 17, x: 60, y: 78, label: 'ANT-E', type: 'agent' },
  ];

  // Laser beams - FULL NETWORK
  const laserBeams = [
    // North America chain
    { from: 0, to: 1, delay: '0s' },
    { from: 1, to: 2, delay: '0.2s' },
    // NA to SA
    { from: 2, to: 3, delay: '0.4s' },
    { from: 3, to: 4, delay: '0.6s' },
    // NA to EU
    { from: 1, to: 6, delay: '0.8s' },
    // Europe chain
    { from: 5, to: 6, delay: '1s' },
    { from: 6, to: 7, delay: '1.2s' },
    // EU to Africa
    { from: 7, to: 8, delay: '1.4s' },
    { from: 8, to: 9, delay: '1.6s' },
    // EU to CORE
    { from: 7, to: 10, delay: '1.8s' },
    // CORE connections
    { from: 10, to: 11, delay: '2s' },
    { from: 10, to: 8, delay: '2.2s' },
    // Asia chain
    { from: 11, to: 12, delay: '2.4s' },
    { from: 12, to: 13, delay: '2.6s' },
    // Asia to SEA
    { from: 12, to: 14, delay: '2.8s' },
    // SEA to Australia
    { from: 14, to: 15, delay: '3s' },
    { from: 13, to: 15, delay: '3.2s' },
    // Antarctica connections
    { from: 4, to: 16, delay: '3.4s' },
    { from: 16, to: 17, delay: '3.6s' },
    { from: 9, to: 17, delay: '3.8s' },
    // Cross-continental
    { from: 0, to: 5, delay: '4s' },
    { from: 6, to: 11, delay: '4.2s' },
    { from: 15, to: 17, delay: '4.4s' },
  ];

  // Threat indicators that pop up near nodes
  const threats = [
    { x: 25, y: 28, text: 'BUNDLE FOUND', delay: '0s' },
    { x: 45, y: 35, text: 'SCAM DETECTED', delay: '2s' },
    { x: 72, y: 38, text: 'SYNDICATE', delay: '4s' },
    { x: 75, y: 55, text: 'RUG ALERT', delay: '6s' },
  ];

  return (
    <>
      <style>{styles}</style>
      <div className="argus-landing">
        {/* ===== INTRO SCREEN ===== */}
        {introVisible && (
          <div
            className={`intro-screen ${introDiving ? 'diving' : ''}`}
            onClick={handleIntroClick}
          >
            <div className="intro-particles">
              {particles.map((p, i) => (
                <div
                  key={i}
                  className="particle"
                  style={{
                    left: p.left,
                    animationDelay: p.animationDelay,
                    animationDuration: p.animationDuration,
                  }}
                />
              ))}
            </div>
            <div className="intro-content">
              <ArgusEye className="argus-eye" />
              <div className="intro-title">Argus AI</div>
            </div>
            <div className="intro-hint">Click to enter</div>
          </div>
        )}

        {/* ===== MAIN JOURNEY ===== */}
        <div className={`journey ${journeyVisible ? 'visible' : ''}`}>

          {/* Section: The Darkness */}
          <section
            id="darkness"
            className="narrative-section section-darkness"
            ref={(el) => (sectionRefs.current['darkness'] = el)}
          >
            <div className={`narrative-content ${visibleSections.has('darkness') ? 'visible' : ''}`}>
              <div className="narrative-label">Chapter I</div>
              <h1 className="narrative-title">
                In the shadows,<br /><span>scammers lurk</span>
              </h1>
              <p className="narrative-text">
                Every day, thousands of traders lose millions to coordinated pump-and-dump schemes,
                honeypots, and rug pulls. The predators hide in plain sight, moving from token to token,
                leaving devastation in their wake.
              </p>
              <div className="darkness-stats">
                <div className="darkness-stat">
                  <div className="darkness-stat-value">$2.8B</div>
                  <div className="darkness-stat-label">Lost to rugs in 2024</div>
                </div>
                <div className="darkness-stat">
                  <div className="darkness-stat-value">47%</div>
                  <div className="darkness-stat-label">Tokens are scams</div>
                </div>
                <div className="darkness-stat">
                  <div className="darkness-stat-value">3.2s</div>
                  <div className="darkness-stat-label">Average rug time</div>
                </div>
              </div>
            </div>
          </section>

          {/* Section: The Awakening */}
          <section
            id="awakening"
            className="narrative-section section-awakening"
            ref={(el) => (sectionRefs.current['awakening'] = el)}
          >
            <div className={`narrative-content ${visibleSections.has('awakening') ? 'visible' : ''}`}>
              <ArgusEye className="awakening-eye" />
              <div className="narrative-label">Chapter II</div>
              <h1 className="narrative-title">
                Until the <span>eye opened</span>
              </h1>
              <p className="narrative-text">
                Argus AI emerged from the void — a hundred-eyed watcher that never sleeps.
                Compressing 2MB of blockchain data into 116 bytes. Running inference in 13 milliseconds.
                Seeing patterns humans cannot perceive. Remembering every scammer who dared to rug.
              </p>
            </div>
          </section>

          {/* Section: The Swarm */}
          <section
            id="swarm"
            className="narrative-section section-swarm"
            ref={(el) => (sectionRefs.current['swarm'] = el)}
          >
            <div className={`narrative-content ${visibleSections.has('swarm') ? 'visible' : ''}`}>
              <div className="narrative-label">Chapter III</div>
              <h1 className="narrative-title">
                Four agents<br /><span>emerged from darkness</span>
              </h1>
              <p className="narrative-text">
                A coordinated swarm of autonomous AI agents, each with a specialized purpose.
                Working together. Sharing intelligence. Hunting as one.
              </p>
            </div>
            <div className="agents-grid">
              <div className={`agent-card ${visibleSections.has('swarm') ? 'visible' : ''}`}>
                <div className="agent-icon scout">
                  <i className="fa-solid fa-satellite-dish"></i>
                </div>
                <div className="agent-name">Scout</div>
                <div className="agent-role">Mempool Patrol</div>
                <div className="agent-desc">
                  Prowls the mempool 24/7, detecting new token launches within milliseconds.
                  Performs rapid triage scans and flags suspicious activity before others even notice.
                </div>
              </div>
              <div className={`agent-card ${visibleSections.has('swarm') ? 'visible' : ''}`}>
                <div className="agent-icon analyst">
                  <i className="fa-solid fa-eye"></i>
                </div>
                <div className="agent-name">Analyst</div>
                <div className="agent-role">Deep Investigation</div>
                <div className="agent-desc">
                  Dissects contracts, traces fund flows, and builds complete threat profiles.
                  Compresses raw blockchain data into dense feature vectors for pattern matching.
                </div>
              </div>
              <div className={`agent-card ${visibleSections.has('swarm') ? 'visible' : ''}`}>
                <div className="agent-icon hunter">
                  <i className="fa-solid fa-crosshairs"></i>
                </div>
                <div className="agent-name">Hunter</div>
                <div className="agent-role">Network Tracker</div>
                <div className="agent-desc">
                  Tracks scammer wallets across tokens, building profiles of repeat offenders.
                  Maintains a database of syndicate networks and alerts when they resurface.
                </div>
              </div>
              <div className={`agent-card ${visibleSections.has('swarm') ? 'visible' : ''}`}>
                <div className="agent-icon trader">
                  <i className="fa-solid fa-coins"></i>
                </div>
                <div className="agent-name">Trader</div>
                <div className="agent-role">Position Guardian</div>
                <div className="agent-desc">
                  Executes autonomous trades based on swarm intelligence. Auto-exits positions
                  when danger signals emerge. Your guardian while you sleep.
                </div>
              </div>
            </div>
          </section>

          {/* Section: The Hunt */}
          <section
            id="hunt"
            className="narrative-section section-hunt"
            ref={(el) => (sectionRefs.current['hunt'] = el)}
          >
            <div className={`narrative-content ${visibleSections.has('hunt') ? 'visible' : ''}`}>
              <div className="narrative-label">Chapter IV</div>
              <h1 className="narrative-title">
                Now they <span>hunt as one</span>
              </h1>
              <p className="narrative-text">
                Watch the swarm coordinate in real-time as they expose a threat.
              </p>

              {/* Terminal Preview */}
              <div className="terminal-preview" ref={terminalRef}>
                <div className="terminal-header">
                  <div className="terminal-dot red" />
                  <div className="terminal-dot yellow" />
                  <div className="terminal-dot green" />
                  <div className="terminal-title">argus-swarm — threat detection</div>
                </div>
                <div className="terminal-body">
                  {terminalContent.map((line, i) => (
                    <div
                      key={i}
                      className={`terminal-line ${i < terminalLines ? 'visible' : ''}`}
                      style={{ transitionDelay: `${i * 0.05}s` }}
                    >
                      <span className={line.class}>{line.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="hunt-steps">
              <div className={`hunt-step ${visibleSections.has('hunt') ? 'visible' : ''}`}>
                <div className="hunt-step-num">1</div>
                <div className="hunt-step-content">
                  <h4>Mark the Target</h4>
                  <p>Submit a token address. The hunt begins.</p>
                </div>
              </div>
              <div className={`hunt-step ${visibleSections.has('hunt') ? 'visible' : ''}`}>
                <div className="hunt-step-num">2</div>
                <div className="hunt-step-content">
                  <h4>Deploy the Swarm</h4>
                  <p>Scouts scan, Analysts dissect, Hunters trace wallet networks across tokens.</p>
                </div>
              </div>
              <div className={`hunt-step ${visibleSections.has('hunt') ? 'visible' : ''}`}>
                <div className="hunt-step-num">3</div>
                <div className="hunt-step-content">
                  <h4>Expose the Threat</h4>
                  <p>Pattern matching reveals syndicates, honeypots, and repeat offenders.</p>
                </div>
              </div>
              <div className={`hunt-step ${visibleSections.has('hunt') ? 'visible' : ''}`}>
                <div className="hunt-step-num">4</div>
                <div className="hunt-step-content">
                  <h4>Execute or Retreat</h4>
                  <p>Trade with intelligence or walk away. The choice is yours.</p>
                </div>
              </div>
            </div>
          </section>

          {/* Section: The Engine */}
          <section
            id="engine"
            className="narrative-section section-engine"
            ref={(el) => (sectionRefs.current['engine'] = el)}
          >
            <div className={`narrative-content ${visibleSections.has('engine') ? 'visible' : ''}`}>
              <div className="narrative-label">Chapter V</div>
              <h1 className="narrative-title">
                BitNet <span>1-bit AI</span>
              </h1>
              <p className="narrative-text">
                We compress the entire blockchain state into a neural fingerprint.
                Every transaction. Every wallet. Every sin — remembered forever.
              </p>
            </div>
            <div className="engine-stats">
              <div className={`engine-stat ${visibleSections.has('engine') ? 'visible' : ''}`} style={{ transitionDelay: '0.1s' }}>
                <div className="engine-stat-value">17,000x</div>
                <div className="engine-stat-label">Data Compression</div>
              </div>
              <div className={`engine-stat ${visibleSections.has('engine') ? 'visible' : ''}`} style={{ transitionDelay: '0.2s' }}>
                <div className="engine-stat-value">13ms</div>
                <div className="engine-stat-label">Inference Time</div>
              </div>
              <div className={`engine-stat ${visibleSections.has('engine') ? 'visible' : ''}`} style={{ transitionDelay: '0.3s' }}>
                <div className="engine-stat-value">116B</div>
                <div className="engine-stat-label">Feature Vector</div>
              </div>
              <div className={`engine-stat ${visibleSections.has('engine') ? 'visible' : ''}`} style={{ transitionDelay: '0.4s' }}>
                <div className="engine-stat-value">$0</div>
                <div className="engine-stat-label">Monthly AI Cost</div>
              </div>
            </div>
          </section>

          {/* Section: Arsenal */}
          <section
            id="arsenal"
            className="narrative-section section-arsenal"
            ref={(el) => (sectionRefs.current['arsenal'] = el)}
          >
            <div className={`narrative-content ${visibleSections.has('arsenal') ? 'visible' : ''}`}>
              <div className="narrative-label">Chapter VI</div>
              <h1 className="narrative-title">
                Weapons <span>forged in darkness</span>
              </h1>
            </div>
            <div className="arsenal-grid">
              {[
                { title: 'Syndicate Scanner', desc: 'Same-block transaction analysis exposes coordinated pump groups' },
                { title: 'Bundle Detection', desc: 'Identify wallet clusters controlling supply before they dump' },
                { title: 'Security Check', desc: 'Instant checks on mint/freeze authority, LP lock, contract risks' },
                { title: 'Dev Tracker', desc: 'Analyze creator wallet age, deployment history, activity patterns' },
                { title: 'AutoGuard', desc: 'Set take profit, stop loss, trailing stops for autonomous exits' },
                { title: 'Quick Trade', desc: 'One-click Jupiter swaps with dedicated trading wallet' },
                { title: 'Origin Vault', desc: 'Private keys isolated in separate secure origin, protected from XSS' },
                { title: 'Pattern Library', desc: '8 known scam patterns with weighted similarity scoring' },
                { title: 'Outcome Learning', desc: 'Self-improving AI that tracks predictions vs actual outcomes' },
              ].map((item, i) => (
                <div
                  key={i}
                  className={`arsenal-item ${visibleSections.has('arsenal') ? 'visible' : ''}`}
                  style={{ transitionDelay: `${i * 0.05}s` }}
                >
                  <h5>{item.title}</h5>
                  <p>{item.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Section: Pricing */}
          <section
            id="pricing"
            className="narrative-section section-pricing"
            ref={(el) => (sectionRefs.current['pricing'] = el)}
          >
            <div className={`narrative-content ${visibleSections.has('pricing') ? 'visible' : ''}`}>
              <div className="narrative-label">Chapter VII</div>
              <h1 className="narrative-title">
                Choose your <span>tier</span>
              </h1>
              <p className="narrative-text">
                Start free. Unlock unlimited power with $ARGUS tokens.
              </p>
            </div>
            <div className="pricing-grid">
              {/* Free */}
              <div className={`pricing-card ${visibleSections.has('pricing') ? 'visible' : ''}`}>
                <div className="pricing-tier">Free</div>
                <div className="pricing-price">$0 <span>/month</span></div>
                <div className="pricing-desc">Try the platform risk-free</div>
                <ul className="pricing-features">
                  <li><span className="check">&#10003;</span> 10 scans per day</li>
                  <li><span className="check">&#10003;</span> AI risk analysis</li>
                  <li><span className="check">&#10003;</span> Bundle detection</li>
                  <li><span className="check">&#10003;</span> One-click trading</li>
                  <li><span className="limit">—</span> Basic support</li>
                </ul>
                <a href="https://app.argusguard.io" className="pricing-cta pricing-cta-outline">Get Started</a>
              </div>
              {/* Holder */}
              <div className={`pricing-card featured ${visibleSections.has('pricing') ? 'visible' : ''}`}>
                <div className="pricing-tier">Holder</div>
                <div className="pricing-price">1K+ <span>$ARGUS</span></div>
                <div className="pricing-desc">For active traders</div>
                <ul className="pricing-features">
                  <li><span className="check">&#10003;</span> <strong>Unlimited</strong> scans</li>
                  <li><span className="check">&#10003;</span> AI risk analysis</li>
                  <li><span className="check">&#10003;</span> Bundle detection</li>
                  <li><span className="check">&#10003;</span> One-click trading</li>
                  <li><span className="check">&#10003;</span> Priority support</li>
                </ul>
                <a href="https://app.argusguard.io" className="pricing-cta pricing-cta-primary">Hold $ARGUS</a>
              </div>
              {/* Pro */}
              <div className={`pricing-card ${visibleSections.has('pricing') ? 'visible' : ''}`}>
                <div className="pricing-tier">Pro</div>
                <div className="pricing-price">10K+ <span>$ARGUS</span></div>
                <div className="pricing-desc">For power users</div>
                <ul className="pricing-features">
                  <li><span className="check">&#10003;</span> <strong>Unlimited</strong> scans</li>
                  <li><span className="check">&#10003;</span> Syndicate network map</li>
                  <li><span className="check">&#10003;</span> Early feature access</li>
                  <li><span className="check">&#10003;</span> API access (coming)</li>
                  <li><span className="check">&#10003;</span> Direct support</li>
                </ul>
                <a href="https://app.argusguard.io" className="pricing-cta pricing-cta-outline">Hold $ARGUS</a>
              </div>
            </div>
          </section>

          {/* Section: Token */}
          <section
            id="token"
            className="narrative-section section-token"
            ref={(el) => (sectionRefs.current['token'] = el)}
          >
            <div className={`narrative-content ${visibleSections.has('token') ? 'visible' : ''}`}>
              <div className="narrative-label">Chapter VIII</div>
              <h1 className="narrative-title">
                The <span>$ARGUS</span> token
              </h1>
              <p className="narrative-text">
                Hold $ARGUS to unlock unlimited scans and premium features.
                No subscriptions. Just hold.
              </p>
            </div>
            <div className={`token-card ${visibleSections.has('token') ? 'visible' : ''}`}>
              <div className="token-symbol">$ARGUS</div>
              <div className="token-name">The Watcher Token</div>
              <div className="token-ca">
                <div>
                  <div className="token-ca-label">Contract Address</div>
                  <div className="token-ca-address">{TOKEN_CA}</div>
                </div>
                <button className={`token-ca-copy ${copied ? 'copied' : ''}`} onClick={handleCopy}>
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <div className="token-links">
                <a
                  href={`https://jup.ag/swap/SOL-${TOKEN_CA}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="token-link"
                >
                  <i className="fa-solid fa-rocket"></i>
                  Buy on Jupiter
                </a>
                <a
                  href={`https://raydium.io/swap/?inputCurrency=sol&outputCurrency=${TOKEN_CA}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="token-link"
                >
                  <i className="fa-solid fa-bolt"></i>
                  Buy on Raydium
                </a>
                <a
                  href={`https://dexscreener.com/solana/${TOKEN_CA}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="token-link"
                >
                  <i className="fa-solid fa-chart-line"></i>
                  DexScreener
                </a>
              </div>
            </div>
          </section>

          {/* Section: Roadmap */}
          <section
            id="roadmap"
            className="narrative-section section-roadmap"
            ref={(el) => (sectionRefs.current['roadmap'] = el)}
          >
            <div className={`narrative-content ${visibleSections.has('roadmap') ? 'visible' : ''}`}>
              <div className="narrative-label">Chapter IX</div>
              <h1 className="narrative-title">
                The path <span>ahead</span>
              </h1>
              <p className="narrative-text">
                Building the most powerful AI-driven crypto defense network.
              </p>
            </div>
            <div className="roadmap-timeline">
              {/* Phase 1 */}
              <div className={`roadmap-phase ${visibleSections.has('roadmap') ? 'visible' : ''}`} style={{ transitionDelay: '0.1s' }}>
                <div className="roadmap-content">
                  <div className="roadmap-phase-label">Phase 1 — Foundation</div>
                  <div className="roadmap-phase-title">The Awakening</div>
                  <ul className="roadmap-items">
                    <li><i className="fa-solid fa-check done"></i> Token launch & initial liquidity</li>
                    <li><i className="fa-solid fa-check done"></i> AI risk analysis engine</li>
                    <li><i className="fa-solid fa-check done"></i> Bundle detection system</li>
                    <li><i className="fa-solid fa-check done"></i> One-click Jupiter trading</li>
                  </ul>
                </div>
                <div className="roadmap-marker completed">
                  <i className="fa-solid fa-check"></i>
                </div>
              </div>

              {/* Phase 2 */}
              <div className={`roadmap-phase ${visibleSections.has('roadmap') ? 'visible' : ''}`} style={{ transitionDelay: '0.2s' }}>
                <div className="roadmap-content">
                  <div className="roadmap-phase-label">Phase 2 — Evolution</div>
                  <div className="roadmap-phase-title">The Swarm Awakens</div>
                  <ul className="roadmap-items">
                    <li><i className="fa-solid fa-check done"></i> Multi-agent architecture</li>
                    <li><i className="fa-solid fa-check done"></i> BitNet 1-bit AI engine</li>
                    <li><i className="fa-solid fa-spinner fa-spin progress"></i> Autonomous trading agents</li>
                    <li><i className="fa-solid fa-spinner fa-spin progress"></i> Real-time dashboard</li>
                  </ul>
                </div>
                <div className="roadmap-marker current">
                  <i className="fa-solid fa-code"></i>
                </div>
              </div>

              {/* Phase 3 */}
              <div className={`roadmap-phase ${visibleSections.has('roadmap') ? 'visible' : ''}`} style={{ transitionDelay: '0.3s' }}>
                <div className="roadmap-content">
                  <div className="roadmap-phase-label">Phase 3 — Expansion</div>
                  <div className="roadmap-phase-title">The Network Spreads</div>
                  <ul className="roadmap-items">
                    <li><i className="fa-solid fa-circle pending"></i> Telegram alert bot</li>
                    <li><i className="fa-solid fa-circle pending"></i> Public API for developers</li>
                    <li><i className="fa-solid fa-circle pending"></i> Mobile companion app</li>
                    <li><i className="fa-solid fa-circle pending"></i> Portfolio guardian mode</li>
                  </ul>
                </div>
                <div className="roadmap-marker">
                  <i className="fa-solid fa-rocket"></i>
                </div>
              </div>

              {/* Phase 4 */}
              <div className={`roadmap-phase ${visibleSections.has('roadmap') ? 'visible' : ''}`} style={{ transitionDelay: '0.4s' }}>
                <div className="roadmap-content">
                  <div className="roadmap-phase-label">Phase 4 — Dominion</div>
                  <div className="roadmap-phase-title">The Global Network</div>
                  <ul className="roadmap-items">
                    <li><i className="fa-solid fa-circle pending"></i> Multi-chain expansion (Base, ETH)</li>
                    <li><i className="fa-solid fa-circle pending"></i> Decentralized agent nodes</li>
                    <li><i className="fa-solid fa-circle pending"></i> Community-powered threat intel</li>
                    <li><i className="fa-solid fa-circle pending"></i> Governance for $ARGUS holders</li>
                  </ul>
                </div>
                <div className="roadmap-marker">
                  <i className="fa-solid fa-globe"></i>
                </div>
              </div>
            </div>
          </section>

          {/* Final Chapter: The Global Network */}
          <section
            id="network"
            className="narrative-section section-network"
            ref={(el) => (sectionRefs.current['network'] = el)}
          >
            <div className={`narrative-content ${visibleSections.has('network') ? 'visible' : ''}`}>
              <div className="narrative-label">Final Chapter</div>
              <h1 className="narrative-title">
                A <span>global swarm</span><br />protecting crypto
              </h1>
              <p className="narrative-text">
                Argus agents scattered across the world, sharing intelligence,
                learning from every threat, growing stronger together.
              </p>
            </div>

            {/* War Map visualization */}
            <div className="network-globe-container">
              {/* World map - actual image (HD) */}
              <img
                src="https://upload.wikimedia.org/wikipedia/commons/thumb/e/ec/World_map_blank_without_borders.svg/2560px-World_map_blank_without_borders.svg.png"
                alt=""
                className="world-map"
              />

              {/* Scanning grid */}
              <div className="scan-grid" />

              {/* Laser beams */}
              {laserBeams.map((beam, i) => {
                const from = networkNodes[beam.from];
                const to = networkNodes[beam.to];
                // Offset to center of triangle
                const fromX = from.x + 1;
                const fromY = from.y + 2;
                const toX = to.x + 1;
                const toY = to.y + 2;

                const dx = toX - fromX;
                const dy = toY - fromY;

                // Container aspect ratio correction (width:height ≈ 2:1)
                // Convert dy to "width-percent" equivalent
                const dyScaled = dy * 0.5;

                // Length in width-percent units
                const length = Math.sqrt(dx * dx + dyScaled * dyScaled);
                // Angle using scaled coordinates
                const angle = Math.atan2(dyScaled, dx) * (180 / Math.PI);

                return (
                  <div
                    key={i}
                    className="laser-beam"
                    style={{
                      left: `${fromX}%`,
                      top: `${fromY}%`,
                      width: `${length}%`,
                      transform: `rotate(${angle}deg)`,
                      transformOrigin: '0 50%',
                      animationDelay: beam.delay,
                    }}
                  />
                );
              })}

              {/* Network nodes */}
              {networkNodes.map((node, i) => (
                <div
                  key={node.id}
                  className={`network-node ${node.type === 'core' ? 'core' : ''} ${node.type === 'threat' ? 'threat' : ''}`}
                  style={{
                    left: `${node.x}%`,
                    top: `${node.y}%`,
                    animationDelay: `${i * 0.15}s`,
                  }}
                  title={node.label}
                />
              ))}

              {/* Threat indicators */}
              {threats.map((threat, i) => (
                <div
                  key={i}
                  className="threat-indicator"
                  style={{
                    left: `${threat.x}%`,
                    top: `${threat.y}%`,
                    animationDelay: threat.delay,
                  }}
                >
                  {threat.text}
                </div>
              ))}

              {/* Network stats */}
              <div className="network-stats">
                <div className="network-stat">
                  <div className="network-stat-value live">10</div>
                  <div className="network-stat-label">Active Agents</div>
                </div>
                <div className="network-stat">
                  <div className="network-stat-value">847</div>
                  <div className="network-stat-label">Threats Blocked</div>
                </div>
                <div className="network-stat">
                  <div className="network-stat-value live">24/7</div>
                  <div className="network-stat-label">Watch Mode</div>
                </div>
                <div className="network-stat">
                  <div className="network-stat-value">&lt;13ms</div>
                  <div className="network-stat-label">Response Time</div>
                </div>
              </div>
            </div>

            <div className={`narrative-content ${visibleSections.has('network') ? 'visible' : ''}`} style={{ marginTop: '40px' }}>
              <ArgusEye className="join-eye" />
              <p className="narrative-text" style={{ marginBottom: '0' }}>
                The shadows await. Nothing escapes the hundred eyes.
              </p>
              <div>
                <a href="https://app.argusguard.io" className="join-cta">
                  Enter the Darkness
                </a>
                <a href="https://github.com/ArgusGuardAI/argus-ai" target="_blank" rel="noopener noreferrer" className="join-secondary">
                  <i className="fa-brands fa-github"></i>
                  View Source
                </a>
              </div>
            </div>
          </section>

          {/* Footer */}
          <footer className="landing-footer">
            <div className="footer-links">
              <a href="https://app.argusguard.io">Launch App</a>
              <a href="https://github.com/ArgusGuardAI/argus-ai" target="_blank" rel="noopener noreferrer">GitHub</a>
              <a href="https://x.com/ArgusPanoptes7z" target="_blank" rel="noopener noreferrer">Twitter</a>
              <a href="https://t.me/ArgusAIAlerts" target="_blank" rel="noopener noreferrer">Telegram</a>
            </div>
            <div className="footer-copy">
              2026 Argus AI — The Watcher in the Dark. Open Source under MIT License.
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}
