import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { GraffitiNote, WalletReputation, HoneypotResult } from '@argusguard/shared';

export function createSupabaseClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey);
}

// Graffiti Notes

export async function getGraffitiNotes(
  supabase: SupabaseClient,
  tokenAddress: string
): Promise<GraffitiNote[]> {
  const { data, error } = await supabase
    .from('graffiti_notes')
    .select('*')
    .eq('token_address', tokenAddress)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching graffiti notes:', error);
    return [];
  }

  return (data || []).map(mapDbToGraffitiNote);
}

export async function createGraffitiNote(
  supabase: SupabaseClient,
  note: Omit<GraffitiNote, 'id' | 'upvotes' | 'downvotes' | 'createdAt'>
): Promise<GraffitiNote | null> {
  const { data, error } = await supabase
    .from('graffiti_notes')
    .insert({
      token_address: note.tokenAddress,
      author_wallet: note.authorWallet,
      content: note.content,
      note_type: note.noteType,
      verified: note.verified,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating graffiti note:', error);
    return null;
  }

  return mapDbToGraffitiNote(data);
}

export async function voteOnNote(
  supabase: SupabaseClient,
  noteId: string,
  vote: 'up' | 'down'
): Promise<boolean> {
  const column = vote === 'up' ? 'upvotes' : 'downvotes';

  const { error } = await supabase.rpc('increment_vote', {
    note_id: noteId,
    vote_column: column,
  });

  if (error) {
    console.error('Error voting on note:', error);
    return false;
  }

  return true;
}

function mapDbToGraffitiNote(row: Record<string, unknown>): GraffitiNote {
  return {
    id: row.id as string,
    tokenAddress: row.token_address as string,
    authorWallet: row.author_wallet as string,
    content: row.content as string,
    noteType: row.note_type as GraffitiNote['noteType'],
    upvotes: row.upvotes as number,
    downvotes: row.downvotes as number,
    createdAt: new Date(row.created_at as string).getTime(),
    verified: row.verified as boolean,
  };
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
