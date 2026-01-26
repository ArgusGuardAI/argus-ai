import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { WalletReputation, HoneypotResult } from '@argusguard/shared';

export function createSupabaseClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey);
}

// Wallet Reputation

export async function getWalletReputation(
  supabase: SupabaseClient,
  address: string
): Promise<WalletReputation | null> {
  const { data, error } = await supabase
    .from('wallet_reputation')
    .select('*')
    .eq('address', address)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // Not found - return default
      return null;
    }
    console.error('Error fetching wallet reputation:', error);
    return null;
  }

  return mapDbToWalletReputation(data);
}

export async function upsertWalletReputation(
  supabase: SupabaseClient,
  reputation: WalletReputation
): Promise<boolean> {
  const { error } = await supabase.from('wallet_reputation').upsert({
    address: reputation.address,
    deployed_tokens: reputation.deployedTokens,
    rug_count: reputation.rugCount,
    successful_projects: reputation.successfulProjects,
    first_seen: new Date(reputation.firstSeen).toISOString(),
    last_active: new Date(reputation.lastActive).toISOString(),
    risk_score: reputation.riskScore,
    tags: reputation.tags,
  });

  if (error) {
    console.error('Error upserting wallet reputation:', error);
    return false;
  }

  return true;
}

function mapDbToWalletReputation(row: Record<string, unknown>): WalletReputation {
  return {
    address: row.address as string,
    deployedTokens: row.deployed_tokens as number,
    rugCount: row.rug_count as number,
    successfulProjects: row.successful_projects as number,
    firstSeen: new Date(row.first_seen as string).getTime(),
    lastActive: new Date(row.last_active as string).getTime(),
    riskScore: row.risk_score as number,
    tags: row.tags as WalletReputation['tags'],
  };
}

// Scan Cache (backup to KV)

export async function cacheScanResult(
  supabase: SupabaseClient,
  result: HoneypotResult
): Promise<void> {
  const { error } = await supabase.from('scan_results').upsert({
    token_address: result.tokenAddress,
    risk_level: result.riskLevel,
    risk_score: result.riskScore,
    confidence: result.confidence,
    flags: result.flags,
    summary: result.summary,
    checked_at: new Date(result.checkedAt).toISOString(),
  });

  if (error) {
    console.error('Error caching scan result:', error);
  }
}
