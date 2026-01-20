import type {
  HoneypotResult,
  GraffitiNote,
  GraffitiListResponse,
  WalletHistoryResponse,
  SubscriptionStatus,
  CheckoutSession,
  PortalSession,
} from '@argusguard/shared';

const API_BASE =
  process.env.PLASMO_PUBLIC_API_URL || 'https://api.argusguard.io';

// ============================================
// Token Analysis
// ============================================

export interface AnalyzeOptions {
  forceRefresh?: boolean;
}

export async function analyzeToken(
  tokenAddress: string,
  options: AnalyzeOptions = {}
): Promise<HoneypotResult | null> {
  // Retry up to 2 times with 60 second timeout each
  const maxRetries = 2;
  const timeoutMs = 60000; // 60 seconds - AI analysis can be slow

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      console.log(`[ArgusGuard] Analyze attempt ${attempt + 1}/${maxRetries} for ${tokenAddress.slice(0, 8)}...`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(`${API_BASE}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenAddress,
          chain: 'solana',
          forceRefresh: options.forceRefresh,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error(`[ArgusGuard] API error: ${response.status}`);
        if (attempt < maxRetries - 1) continue; // Retry
        return null;
      }

      const data = await response.json();
      console.log(`[ArgusGuard] Analysis complete for ${tokenAddress.slice(0, 8)}: ${data.riskLevel}`);
      return data;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.error(`[ArgusGuard] Request timed out (${timeoutMs}ms), attempt ${attempt + 1}/${maxRetries}`);
      } else {
        console.error(`[ArgusGuard] Request failed:`, error);
      }
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 1000)); // Wait 1s before retry
        continue;
      }
    }
  }

  console.error(`[ArgusGuard] All ${maxRetries} attempts failed for ${tokenAddress.slice(0, 8)}`);
  return null;
}

export async function getCachedAnalysis(tokenAddress: string): Promise<HoneypotResult | null> {
  try {
    const response = await fetch(`${API_BASE}/analyze/${tokenAddress}`);

    if (!response.ok) {
      return null;
    }

    return response.json();
  } catch (error) {
    console.error('Get cached analysis failed:', error);
    return null;
  }
}

// ============================================
// Authentication
// ============================================

export interface AuthMessage {
  message: string;
  instructions: string;
}

export async function getAuthMessage(
  action: string = 'graffiti',
  tokenAddress?: string
): Promise<AuthMessage | null> {
  try {
    const params = new URLSearchParams({ action });
    if (tokenAddress) {
      params.append('tokenAddress', tokenAddress);
    }

    const response = await fetch(`${API_BASE}/graffiti/auth/message?${params}`);

    if (!response.ok) {
      console.error('Get auth message error:', response.status);
      return null;
    }

    return response.json();
  } catch (error) {
    console.error('Get auth message failed:', error);
    return null;
  }
}

export interface AuthCheckResult {
  eligible: boolean;
  verified: boolean;
  hasTokens: boolean;
  tokenBalance: number;
  requiredBalance: number;
  error?: string;
}

export async function checkAuthEligibility(
  walletAddress: string,
  message: string,
  signature: string
): Promise<AuthCheckResult | null> {
  try {
    const response = await fetch(`${API_BASE}/graffiti/auth/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress, message, signature }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return {
        eligible: false,
        verified: false,
        hasTokens: false,
        tokenBalance: 0,
        requiredBalance: 1000,
        error: error.error || 'Authentication failed',
      };
    }

    return response.json();
  } catch (error) {
    console.error('Auth check failed:', error);
    return null;
  }
}

// ============================================
// Graffiti Notes
// ============================================

export async function getGraffitiNotes(tokenAddress: string): Promise<GraffitiNote[]> {
  try {
    const response = await fetch(`${API_BASE}/graffiti/${tokenAddress}`);

    if (!response.ok) {
      return [];
    }

    const data: GraffitiListResponse = await response.json();
    return data.notes || [];
  } catch (error) {
    console.error('Get graffiti notes failed:', error);
    return [];
  }
}

export interface CreateNoteParams {
  tokenAddress: string;
  content: string;
  noteType: 'WARNING' | 'INFO' | 'POSITIVE';
  walletAddress: string;
  message: string;
  signature: string;
}

export interface CreateNoteResult {
  success: boolean;
  note?: GraffitiNote;
  error?: string;
  verified?: boolean;
  hasTokens?: boolean;
  tokenBalance?: number;
}

export async function createGraffitiNote(params: CreateNoteParams): Promise<CreateNoteResult> {
  try {
    const response = await fetch(`${API_BASE}/graffiti`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || 'Failed to create note',
        verified: data.verified,
        hasTokens: data.hasTokens,
        tokenBalance: data.tokenBalance,
      };
    }

    return {
      success: true,
      note: data,
    };
  } catch (error) {
    console.error('Create graffiti failed:', error);
    return {
      success: false,
      error: 'Network error. Please try again.',
    };
  }
}

// Test mode: create note without wallet signature
export interface CreateTestNoteParams {
  tokenAddress: string;
  content: string;
  noteType: 'WARNING' | 'INFO' | 'POSITIVE';
}

export async function createTestGraffitiNote(params: CreateTestNoteParams): Promise<CreateNoteResult> {
  try {
    const response = await fetch(`${API_BASE}/graffiti/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || 'Failed to create note',
      };
    }

    return {
      success: true,
      note: data,
    };
  } catch (error) {
    console.error('Create test graffiti failed:', error);
    return {
      success: false,
      error: 'Network error. Please try again.',
    };
  }
}

export interface VoteParams {
  noteId: string;
  vote: 'up' | 'down';
  walletAddress: string;
  message: string;
  signature: string;
}

export async function voteOnNote(params: VoteParams): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/graffiti/${params.noteId}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vote: params.vote,
        walletAddress: params.walletAddress,
        message: params.message,
        signature: params.signature,
      }),
    });

    return response.ok;
  } catch (error) {
    console.error('Vote failed:', error);
    return false;
  }
}

// ============================================
// Wallet History
// ============================================

export async function getWalletHistory(address: string): Promise<WalletHistoryResponse | null> {
  try {
    const response = await fetch(`${API_BASE}/wallet-history/${address}`);

    if (!response.ok) {
      return null;
    }

    return response.json();
  } catch (error) {
    console.error('Get wallet history failed:', error);
    return null;
  }
}

// ============================================
// Subscription
// ============================================

export async function getSubscriptionStatus(walletAddress: string): Promise<SubscriptionStatus> {
  try {
    const response = await fetch(`${API_BASE}/subscribe/status/${walletAddress}`);

    if (!response.ok) {
      return { subscribed: false, status: null };
    }

    return response.json();
  } catch (error) {
    console.error('Get subscription status failed:', error);
    return { subscribed: false, status: null };
  }
}

export async function createCheckoutSession(
  walletAddress: string,
  successUrl?: string,
  cancelUrl?: string
): Promise<CheckoutSession | null> {
  try {
    const response = await fetch(`${API_BASE}/subscribe/create-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress, successUrl, cancelUrl }),
    });

    if (!response.ok) {
      console.error('Create checkout error:', response.status);
      return null;
    }

    return response.json();
  } catch (error) {
    console.error('Create checkout failed:', error);
    return null;
  }
}

export async function createPortalSession(
  walletAddress: string,
  returnUrl?: string
): Promise<PortalSession | null> {
  try {
    const response = await fetch(`${API_BASE}/subscribe/portal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress, returnUrl }),
    });

    if (!response.ok) {
      console.error('Create portal error:', response.status);
      return null;
    }

    return response.json();
  } catch (error) {
    console.error('Create portal failed:', error);
    return null;
  }
}
