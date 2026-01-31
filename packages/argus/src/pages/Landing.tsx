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
    padding: 100px 24px;
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
    width: 56px;
    height: 56px;
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 20px;
  }

  .agent-icon.scout { background: linear-gradient(135deg, var(--purple) 0%, #5B21B6 100%); }
  .agent-icon.analyst { background: linear-gradient(135deg, var(--accent) 0%, #991B1B 100%); }
  .agent-icon.hunter { background: linear-gradient(135deg, var(--amber) 0%, #D97706 100%); }
  .agent-icon.trader { background: linear-gradient(135deg, var(--emerald) 0%, #16A34A 100%); }

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
    padding: 100px 24px;
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
    padding: 100px 24px;
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
    padding: 100px 24px;
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

  .pricing-note {
    text-align: center;
    margin-top: 40px;
    font-size: 0.85rem;
    color: var(--text-dim);
    max-width: 500px;
    margin-left: auto;
    margin-right: auto;
  }

  /* Section: Join */
  .section-join {
    background: var(--bg-void);
    padding: 120px 24px;
    text-align: center;
  }

  .join-eye {
    width: 80px;
    height: 80px;
    margin: 0 auto 40px;
    filter: drop-shadow(0 0 30px var(--accent-glow));
    animation: awakening-glow 2s ease-in-out infinite;
  }

  .join-cta {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 18px 48px;
    background: linear-gradient(135deg, var(--accent) 0%, #991B1B 100%);
    color: white;
    font-size: 1rem;
    font-weight: 600;
    border-radius: 12px;
    margin-top: 40px;
    cursor: pointer;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
    text-decoration: none;
    box-shadow: 0 4px 30px var(--accent-dim);
  }

  .join-cta:hover {
    transform: translateY(-3px);
    box-shadow: 0 8px 40px var(--accent-glow);
  }

  .join-secondary {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 14px 28px;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.9rem;
    font-weight: 500;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    margin-top: 16px;
    margin-left: 12px;
    cursor: pointer;
    transition: border-color 0.2s ease, color 0.2s ease;
    text-decoration: none;
  }

  .join-secondary:hover {
    border-color: var(--accent);
    color: var(--text-main);
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

  // Handle intro click
  const handleIntroClick = useCallback(() => {
    setIntroDiving(true);
    setTimeout(() => {
      setIntroVisible(false);
      setJourneyVisible(true);
    }, 1000);
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
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 16v-4M12 8h.01"/>
                  </svg>
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
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
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
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                    <circle cx="11" cy="11" r="8"/>
                    <path d="m21 21-4.35-4.35"/>
                  </svg>
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
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                  </svg>
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
              <div className="narrative-label">The Dark Engine</div>
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
              <div className="narrative-label">The Arsenal</div>
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
              <div className="narrative-label">Access Levels</div>
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
            <p className="pricing-note">
              <strong>No subscriptions.</strong> Hold $ARGUS tokens in your wallet to unlock premium features instantly.
            </p>
          </section>

          {/* Section: Join */}
          <section
            id="join"
            className="narrative-section section-join"
            ref={(el) => (sectionRefs.current['join'] = el)}
          >
            <div className={`narrative-content ${visibleSections.has('join') ? 'visible' : ''}`}>
              <ArgusEye className="join-eye" />
              <div className="narrative-label">Chapter V</div>
              <h1 className="narrative-title">
                Will you join<br /><span>the watchers?</span>
              </h1>
              <p className="narrative-text">
                The shadows await. Let the agents hunt for you.<br />
                Nothing escapes the hundred eyes.
              </p>
              <div>
                <a href="https://app.argusguard.io" className="join-cta">
                  Enter the Darkness
                </a>
                <a href="https://github.com/ArgusGuardAI/argus-ai" target="_blank" rel="noopener noreferrer" className="join-secondary">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                  </svg>
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
