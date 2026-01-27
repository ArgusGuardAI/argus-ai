const styles = `
  .not-found {
    min-height: 100vh;
    background: #09090B;
    color: #FAFAFA;
    font-family: 'Inter', -apple-system, sans-serif;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 24px;
  }
  .not-found .nf-icon {
    width: 80px;
    height: 80px;
    margin-bottom: 32px;
    opacity: 0.6;
  }
  .not-found .nf-code {
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 5rem;
    font-weight: 800;
    letter-spacing: -0.04em;
    background: linear-gradient(135deg, #10B981 0%, #059669 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    margin-bottom: 12px;
    line-height: 1;
  }
  .not-found h1 {
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: 12px;
  }
  .not-found p {
    font-size: 1rem;
    color: #A1A1AA;
    max-width: 400px;
    margin-bottom: 32px;
    line-height: 1.6;
  }
  .not-found .nf-terminal {
    background: #111113;
    border: 1px solid #27272A;
    border-radius: 12px;
    padding: 20px 28px;
    margin-bottom: 40px;
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 0.82rem;
    text-align: left;
    color: #A1A1AA;
    max-width: 420px;
    width: 100%;
  }
  .not-found .nf-terminal .green { color: #10B981; }
  .not-found .nf-terminal .red { color: #EF4444; }
  .not-found .nf-terminal .dim { color: #52525B; }
  .not-found .nf-actions {
    display: flex;
    gap: 12px;
  }
  .not-found .nf-btn {
    display: inline-flex;
    align-items: center;
    padding: 12px 24px;
    border-radius: 10px;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
    transition: all 0.2s;
  }
  .not-found .nf-btn-primary {
    background: linear-gradient(135deg, #10B981, #059669);
    color: white;
    border: none;
  }
  .not-found .nf-btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(16, 185, 129, 0.3);
  }
  .not-found .nf-btn-outline {
    background: transparent;
    color: #FAFAFA;
    border: 1px solid #27272A;
  }
  .not-found .nf-btn-outline:hover {
    border-color: #10B981;
    background: rgba(16, 185, 129, 0.08);
  }
`;

export default function NotFound() {
  return (
    <>
      <style>{styles}</style>
      <div className="not-found">
        <svg className="nf-icon" viewBox="0 0 32 32" fill="none">
          <path d="M16 4L28 26H4L16 4Z" stroke="#10B981" strokeWidth="1.5" fill="none"/>
          <ellipse cx="16" cy="16" rx="6" ry="4" stroke="#10B981" strokeWidth="1" fill="none"/>
          <circle cx="16" cy="16" r="2" fill="#10B981"/>
        </svg>
        <div className="nf-code">404</div>
        <h1>Page Not Found</h1>
        <p>This route doesn't exist. Maybe the token you're looking for is on our dashboard.</p>
        <div className="nf-terminal">
          <div><span className="dim">$</span> argus scan /unknown-page</div>
          <div><span className="red">[Argus] Error: Route not found</span></div>
          <div><span className="green">[Argus] Redirecting to safety...</span></div>
        </div>
        <div className="nf-actions">
          <a href="/" className="nf-btn nf-btn-primary">Back Home</a>
          <a href="https://app.argusguard.io" className="nf-btn nf-btn-outline">Launch App</a>
        </div>
      </div>
    </>
  );
}
