export type GraffitiNoteType = 'WARNING' | 'INFO' | 'POSITIVE';

export interface GraffitiNote {
  id: string;
  tokenAddress: string;
  authorWallet: string;
  content: string;
  noteType: GraffitiNoteType;
  upvotes: number;
  downvotes: number;
  createdAt: number;
  verified: boolean; // Author holds ARGUSGUARD token
}

export interface GraffitiCreateRequest {
  tokenAddress: string;
  content: string;
  noteType: GraffitiNoteType;
  signature: string; // Wallet signature for auth
  walletAddress: string;
}

export interface GraffitiVoteRequest {
  noteId: string;
  vote: 'up' | 'down';
  walletAddress: string;
  signature: string;
}

export interface GraffitiListResponse {
  notes: GraffitiNote[];
  totalCount: number;
}
