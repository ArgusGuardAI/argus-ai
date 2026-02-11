import { useEffect } from 'react';

const styles = `
  /* ARGUS MAINTENANCE PAGE */
  .maintenance-page {
    --bg-void: #020202;
    --bg-dark: #050505;
    --text-main: #F0F0F0;
    --text-muted: #8A8A95;
    --accent: #DC2626;
    --accent-glow: rgba(220, 38, 38, 0.6);
    --accent-dim: rgba(220, 38, 38, 0.15);

    background: var(--bg-void);
    color: var(--text-main);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    position: relative;
    -webkit-font-smoothing: antialiased;
  }

  .maintenance-page * { box-sizing: border-box; }

  /* Animated background grid */
  .grid-bg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-image:
      linear-gradient(rgba(220, 38, 38, 0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(220, 38, 38, 0.03) 1px, transparent 1px);
    background-size: 50px 50px;
    animation: grid-pulse 4s ease-in-out infinite;
  }

  @keyframes grid-pulse {
    0%, 100% { opacity: 0.5; }
    50% { opacity: 1; }
  }

  /* Floating particles */
  .particles {
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
    width: 3px;
    height: 3px;
    background: var(--accent);
    border-radius: 50%;
    opacity: 0;
    animation: float-up 10s linear infinite;
  }

  @keyframes float-up {
    0% {
      opacity: 0;
      transform: translateY(100vh) scale(0);
    }
    10% { opacity: 0.5; }
    90% { opacity: 0.5; }
    100% {
      opacity: 0;
      transform: translateY(-50px) scale(1);
    }
  }

  /* Content container */
  .maintenance-content {
    position: relative;
    z-index: 10;
    text-align: center;
    padding: 40px;
  }

  /* The Eye SVG */
  .argus-eye-maintenance {
    width: 200px;
    height: 200px;
    margin: 0 auto 40px;
    display: block;
    filter: drop-shadow(0 0 40px var(--accent-glow)) drop-shadow(0 0 80px var(--accent-dim));
    animation: eye-pulse 3s ease-in-out infinite, eye-float 6s ease-in-out infinite;
  }

  @keyframes eye-pulse {
    0%, 100% {
      filter: drop-shadow(0 0 40px var(--accent-glow)) drop-shadow(0 0 80px var(--accent-dim));
    }
    50% {
      filter: drop-shadow(0 0 80px var(--accent-glow)) drop-shadow(0 0 160px rgba(220, 38, 38, 0.4));
    }
  }

  @keyframes eye-float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-10px); }
  }

  /* Title */
  .maintenance-title {
    font-size: 2.5rem;
    font-weight: 700;
    margin: 0 0 16px 0;
    letter-spacing: -0.02em;
    background: linear-gradient(135deg, var(--text-main) 0%, var(--accent) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  /* Subtitle */
  .maintenance-subtitle {
    font-size: 1.1rem;
    color: var(--text-muted);
    margin: 0 0 40px 0;
    max-width: 500px;
    line-height: 1.6;
  }

  /* Status indicator */
  .status-indicator {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 12px 24px;
    background: rgba(220, 38, 38, 0.1);
    border: 1px solid rgba(220, 38, 38, 0.3);
    border-radius: 100px;
    margin-bottom: 40px;
  }

  .status-dot {
    width: 10px;
    height: 10px;
    background: var(--accent);
    border-radius: 50%;
    animation: blink 1.5s ease-in-out infinite;
  }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .status-text {
    font-size: 0.85rem;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--accent);
    font-weight: 500;
  }

  /* Progress bar */
  .progress-container {
    width: 300px;
    margin: 0 auto 40px;
  }

  .progress-label {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-bottom: 8px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .progress-bar {
    height: 4px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent), #EF4444);
    border-radius: 2px;
    animation: progress-animate 3s ease-in-out infinite;
  }

  @keyframes progress-animate {
    0% { width: 0%; }
    50% { width: 70%; }
    100% { width: 100%; }
  }

  /* Social links */
  .social-links {
    display: flex;
    gap: 20px;
    justify-content: center;
  }

  .social-link {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    color: var(--text-muted);
    text-decoration: none;
    transition: all 0.3s ease;
  }

  .social-link:hover {
    background: rgba(220, 38, 38, 0.15);
    border-color: var(--accent);
    color: var(--accent);
    transform: translateY(-2px);
  }

  .social-link svg {
    width: 20px;
    height: 20px;
  }

  /* Footer text */
  .footer-text {
    position: absolute;
    bottom: 30px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 0.75rem;
    color: var(--text-dim);
    letter-spacing: 0.1em;
  }

  /* Responsive */
  @media (max-width: 480px) {
    .maintenance-title {
      font-size: 1.8rem;
    }
    .maintenance-subtitle {
      font-size: 1rem;
      padding: 0 20px;
    }
    .argus-eye-maintenance {
      width: 140px;
      height: 140px;
    }
  }
`;

// Argus Eye SVG component - Triangle with Eye
const ArgusEye = () => (
  <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="argus-eye-maintenance">
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

// X (Twitter) icon
const XIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
);

// Telegram icon
const TelegramIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
  </svg>
);

export default function Maintenance() {
  useEffect(() => {
    // Inject styles
    const styleEl = document.createElement('style');
    styleEl.textContent = styles;
    document.head.appendChild(styleEl);

    // Set page title
    document.title = 'Argus AI - Maintenance';

    return () => {
      document.head.removeChild(styleEl);
    };
  }, []);

  // Generate random particles
  const particles = Array.from({ length: 30 }, (_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    delay: `${Math.random() * 10}s`,
    duration: `${8 + Math.random() * 4}s`
  }));

  return (
    <div className="maintenance-page">
      {/* Background grid */}
      <div className="grid-bg" />

      {/* Floating particles */}
      <div className="particles">
        {particles.map(p => (
          <div
            key={p.id}
            className="particle"
            style={{
              left: p.left,
              animationDelay: p.delay,
              animationDuration: p.duration
            }}
          />
        ))}
      </div>

      {/* Main content */}
      <div className="maintenance-content">
        <ArgusEye />

        <div className="status-indicator">
          <div className="status-dot" />
          <span className="status-text">System Upgrade in Progress</span>
        </div>

        <h1 className="maintenance-title">The Eye Never Sleeps</h1>
        <p className="maintenance-subtitle">
          We're upgrading our infrastructure to bring you even faster,
          more powerful protection. Back online shortly.
        </p>

        <div className="progress-container">
          <div className="progress-label">
            <span>Syncing</span>
            <span>Infrastructure</span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" />
          </div>
        </div>

        <div className="social-links">
          <a
            href="https://x.com/ArgusPanoptes7z"
            target="_blank"
            rel="noopener noreferrer"
            className="social-link"
            title="Follow us on X"
          >
            <XIcon />
          </a>
          <a
            href="https://t.me/ArgusAIAlerts"
            target="_blank"
            rel="noopener noreferrer"
            className="social-link"
            title="Join our Telegram"
          >
            <TelegramIcon />
          </a>
        </div>
      </div>

      <div className="footer-text">
        ARGUS AI - SOLANA'S VIGILANT GUARDIAN
      </div>
    </div>
  );
}
