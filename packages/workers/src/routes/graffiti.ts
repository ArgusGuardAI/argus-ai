import { Hono } from 'hono';
import type { Bindings } from '../index';
import { GraffitiCreateRequest } from '@whaleshield/shared';
import {
  createSupabaseClient,
  getGraffitiNotes,
  createGraffitiNote,
  voteOnNote,
} from '../services/supabase';
import {
  authenticateUser,
  verifyWalletOwnership,
  generateSignMessage,
} from '../services/auth';

export const graffitiRoutes = new Hono<{ Bindings: Bindings }>();

// Get the message to sign for authentication
graffitiRoutes.get('/auth/message', async (c) => {
  const action = c.req.query('action') || 'graffiti';
  const tokenAddress = c.req.query('tokenAddress');

  const message = generateSignMessage(action, tokenAddress);

  return c.json({
    message,
    instructions: 'Sign this message with your Solana wallet to authenticate.',
  });
});

// Check if a wallet is eligible to post (has required tokens)
graffitiRoutes.post('/auth/check', async (c) => {
  try {
    const body = await c.req.json<{
      walletAddress: string;
      message: string;
      signature: string;
    }>();

    if (!body.walletAddress || !body.message || !body.signature) {
      return c.json({ error: 'walletAddress, message, and signature are required' }, 400);
    }

    const result = await authenticateUser(
      body.walletAddress,
      body.message,
      body.signature,
      {
        requireTokens: true,
        mintAddress: c.env.WHALESHIELD_MINT,
        requiredBalance: 1000,
        heliusApiKey: c.env.HELIUS_API_KEY,
      }
    );

    return c.json({
      eligible: result.authenticated,
      verified: result.verified,
      hasTokens: result.hasTokens,
      tokenBalance: result.tokenBalance,
      requiredBalance: 1000,
      error: result.error,
    });
  } catch (error) {
    console.error('Auth check error:', error);
    return c.json({ error: 'Authentication check failed' }, 500);
  }
});

// Get graffiti notes for a token
graffitiRoutes.get('/:tokenAddress', async (c) => {
  const tokenAddress = c.req.param('tokenAddress');

  const supabase = createSupabaseClient(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY);
  const notes = await getGraffitiNotes(supabase, tokenAddress);

  return c.json({
    notes,
    totalCount: notes.length,
  });
});

// Create a new graffiti note (REQUIRES TOKEN GATING)
graffitiRoutes.post('/', async (c) => {
  try {
    const body = await c.req.json<GraffitiCreateRequest & { message: string }>();

    // Validate required fields
    if (!body.tokenAddress || !body.content || !body.noteType) {
      return c.json({ error: 'tokenAddress, content, and noteType are required' }, 400);
    }

    if (!body.walletAddress || !body.signature || !body.message) {
      return c.json({
        error: 'walletAddress, message, and signature are required for authentication',
        hint: 'First call GET /graffiti/auth/message to get the message to sign',
      }, 401);
    }

    // Validate note type
    if (!['WARNING', 'INFO', 'POSITIVE'].includes(body.noteType)) {
      return c.json({ error: 'noteType must be WARNING, INFO, or POSITIVE' }, 400);
    }

    // Authenticate: verify signature + check token balance
    const authResult = await authenticateUser(
      body.walletAddress,
      body.message,
      body.signature,
      {
        requireTokens: !!c.env.WHALESHIELD_MINT, // Only require tokens if mint is set
        mintAddress: c.env.WHALESHIELD_MINT,
        requiredBalance: 1000,
        heliusApiKey: c.env.HELIUS_API_KEY,
      }
    );

    if (!authResult.authenticated) {
      return c.json({
        error: authResult.error || 'Authentication failed',
        verified: authResult.verified,
        hasTokens: authResult.hasTokens,
        tokenBalance: authResult.tokenBalance,
        requiredBalance: 1000,
      }, 403);
    }

    // Create the note
    const supabase = createSupabaseClient(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY);

    const note = await createGraffitiNote(supabase, {
      tokenAddress: body.tokenAddress,
      authorWallet: body.walletAddress,
      content: body.content.slice(0, 500), // Limit content length
      noteType: body.noteType,
      verified: authResult.hasTokens, // Mark as verified if they hold tokens
    });

    if (!note) {
      return c.json({ error: 'Failed to create note' }, 500);
    }

    return c.json({
      ...note,
      message: 'Note created successfully',
    }, 201);
  } catch (error) {
    console.error('Create graffiti error:', error);
    return c.json({ error: 'Failed to create note' }, 500);
  }
});

// TEST MODE: Create note without wallet (for development only)
graffitiRoutes.post('/test', async (c) => {
  try {
    const body = await c.req.json<{
      tokenAddress: string;
      content: string;
      noteType: 'WARNING' | 'INFO' | 'POSITIVE';
    }>();

    // Validate required fields
    if (!body.tokenAddress || !body.content || !body.noteType) {
      return c.json({ error: 'tokenAddress, content, and noteType are required' }, 400);
    }

    // Validate note type
    if (!['WARNING', 'INFO', 'POSITIVE'].includes(body.noteType)) {
      return c.json({ error: 'noteType must be WARNING, INFO, or POSITIVE' }, 400);
    }

    // Create the note with anonymous author
    const supabase = createSupabaseClient(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY);

    const note = await createGraffitiNote(supabase, {
      tokenAddress: body.tokenAddress,
      authorWallet: 'TEST_MODE_ANONYMOUS',
      content: body.content.slice(0, 500),
      noteType: body.noteType,
      verified: false,
    });

    if (!note) {
      return c.json({ error: 'Failed to create note' }, 500);
    }

    return c.json({
      ...note,
      message: 'Test note created successfully',
    }, 201);
  } catch (error) {
    console.error('Create test graffiti error:', error);
    return c.json({ error: 'Failed to create test note' }, 500);
  }
});

// Vote on a note (requires wallet verification, but not token balance)
graffitiRoutes.post('/:noteId/vote', async (c) => {
  try {
    const noteId = c.req.param('noteId');
    const body = await c.req.json<{
      vote: 'up' | 'down';
      walletAddress: string;
      message: string;
      signature: string;
    }>();

    // Validate vote
    if (!body.vote || !['up', 'down'].includes(body.vote)) {
      return c.json({ error: 'vote must be "up" or "down"' }, 400);
    }

    if (!body.walletAddress || !body.message || !body.signature) {
      return c.json({
        error: 'walletAddress, message, and signature are required',
        hint: 'First call GET /graffiti/auth/message?action=vote to get the message to sign',
      }, 401);
    }

    // Verify wallet ownership (no token requirement for voting)
    const verification = verifyWalletOwnership(
      body.walletAddress,
      body.message,
      body.signature
    );

    if (!verification.verified) {
      return c.json({
        error: verification.error || 'Signature verification failed',
      }, 403);
    }

    // TODO: Track votes per wallet to prevent duplicate voting
    // For now, just record the vote

    const supabase = createSupabaseClient(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY);
    const success = await voteOnNote(supabase, noteId, body.vote);

    if (!success) {
      return c.json({ error: 'Failed to record vote' }, 500);
    }

    return c.json({
      success: true,
      vote: body.vote,
      noteId,
    });
  } catch (error) {
    console.error('Vote error:', error);
    return c.json({ error: 'Failed to record vote' }, 500);
  }
});

// Delete a note (only author can delete)
graffitiRoutes.delete('/:noteId', async (c) => {
  try {
    const noteId = c.req.param('noteId');
    const body = await c.req.json<{
      walletAddress: string;
      message: string;
      signature: string;
    }>();

    if (!body.walletAddress || !body.message || !body.signature) {
      return c.json({ error: 'walletAddress, message, and signature are required' }, 401);
    }

    // Verify wallet ownership
    const verification = verifyWalletOwnership(
      body.walletAddress,
      body.message,
      body.signature
    );

    if (!verification.verified) {
      return c.json({ error: verification.error || 'Signature verification failed' }, 403);
    }

    // Get the note to check ownership
    const supabase = createSupabaseClient(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY);

    const { data: note, error: fetchError } = await supabase
      .from('graffiti_notes')
      .select('author_wallet')
      .eq('id', noteId)
      .single();

    if (fetchError || !note) {
      return c.json({ error: 'Note not found' }, 404);
    }

    if (note.author_wallet !== body.walletAddress) {
      return c.json({ error: 'You can only delete your own notes' }, 403);
    }

    // Delete the note
    const { error: deleteError } = await supabase
      .from('graffiti_notes')
      .delete()
      .eq('id', noteId);

    if (deleteError) {
      console.error('Delete error:', deleteError);
      return c.json({ error: 'Failed to delete note' }, 500);
    }

    return c.json({ success: true, deleted: noteId });
  } catch (error) {
    console.error('Delete error:', error);
    return c.json({ error: 'Failed to delete note' }, 500);
  }
});
