import type { AnalysisResult } from '../types';

const API_BASE = import.meta.env.PROD ? '' : '/api';

export async function analyzeToken(tokenAddress: string): Promise<AnalysisResult> {
  const response = await fetch(`${API_BASE}/sentinel/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tokenAddress }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || `Analysis failed: ${response.status}`);
  }

  return response.json();
}
