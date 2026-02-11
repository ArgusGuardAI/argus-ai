/**
 * PositionStore - PostgreSQL Persistence for Trading Positions
 *
 * Stores active and closed positions for the TraderAgent.
 * Enables position survival across restarts and P&L tracking.
 */

import { Database } from './Database.js';

// ============================================================
// Types
// ============================================================

export interface Position {
  id: string;
  tokenAddress: string;
  tokenSymbol: string;
  poolAddress: string;           // For Yellowstone price tracking
  entryPrice: number;            // Price in SOL per token
  entrySolAmount: number;        // Amount of SOL spent
  tokenAmount: number;           // Tokens received
  stopLossPrice: number;         // Auto-sell if price drops to this
  takeProfitPrice: number;       // Auto-sell if price rises to this
  currentPrice: number;          // Latest price from Yellowstone
  status: 'active' | 'sold' | 'stopped' | 'emergency';
  entryTime: number;             // Unix timestamp
  exitTime?: number;
  exitReason?: 'take_profit' | 'stop_loss' | 'trailing_stop' | 'manual' | 'emergency';
  pnlSol?: number;               // Realized P&L
  txSignature: string;           // Entry transaction
  exitTxSignature?: string;      // Exit transaction
  strategy: string;              // SAFE_EARLY, MOMENTUM, SNIPER
}

export interface CreatePositionInput {
  tokenAddress: string;
  tokenSymbol: string;
  poolAddress: string;
  entryPrice: number;
  entrySolAmount: number;
  tokenAmount: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  txSignature: string;
  strategy: string;
}

export interface PositionStats {
  activeCount: number;
  totalTrades: number;
  totalPnlSol: number;
  winCount: number;
  lossCount: number;
  winRate: number;
}

// ============================================================
// PositionStore Service
// ============================================================

export class PositionStore {
  private db: Database;

  constructor(database: Database) {
    this.db = database;
  }

  /**
   * Create a new position
   */
  async create(input: CreatePositionInput): Promise<Position> {
    const id = `pos_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const position: Position = {
      id,
      tokenAddress: input.tokenAddress,
      tokenSymbol: input.tokenSymbol,
      poolAddress: input.poolAddress,
      entryPrice: input.entryPrice,
      entrySolAmount: input.entrySolAmount,
      tokenAmount: input.tokenAmount,
      stopLossPrice: input.stopLossPrice,
      takeProfitPrice: input.takeProfitPrice,
      currentPrice: input.entryPrice,
      status: 'active',
      entryTime: now,
      txSignature: input.txSignature,
      strategy: input.strategy,
    };

    await this.db.query(`
      INSERT INTO positions (
        id, token_address, token_symbol, pool_address,
        entry_price, entry_sol_amount, token_amount,
        stop_loss_price, take_profit_price, current_price,
        status, entry_time, tx_signature, strategy
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `, [
      position.id,
      position.tokenAddress,
      position.tokenSymbol,
      position.poolAddress,
      position.entryPrice,
      position.entrySolAmount,
      position.tokenAmount,
      position.stopLossPrice,
      position.takeProfitPrice,
      position.currentPrice,
      position.status,
      position.entryTime,
      position.txSignature,
      position.strategy,
    ]);

    console.log(`[PositionStore] Created position ${id} for ${input.tokenSymbol}`);
    return position;
  }

  /**
   * Get a position by ID
   */
  async getById(id: string): Promise<Position | null> {
    const result = await this.db.query(
      'SELECT * FROM positions WHERE id = $1',
      [id]
    );
    return result.rows[0] ? this.rowToPosition(result.rows[0]) : null;
  }

  /**
   * Get position by pool address (for price updates)
   */
  async getByPool(poolAddress: string): Promise<Position | null> {
    const result = await this.db.query(
      `SELECT * FROM positions WHERE pool_address = $1 AND status = 'active'`,
      [poolAddress]
    );
    return result.rows[0] ? this.rowToPosition(result.rows[0]) : null;
  }

  /**
   * Get all active positions
   */
  async getActive(): Promise<Position[]> {
    const result = await this.db.query(
      `SELECT * FROM positions WHERE status = 'active' ORDER BY entry_time DESC`
    );
    return result.rows.map(this.rowToPosition);
  }

  /**
   * Get active position count
   */
  async getActiveCount(): Promise<number> {
    const result = await this.db.query(
      `SELECT COUNT(*) as count FROM positions WHERE status = 'active'`
    );
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Update current price for a position
   */
  async updatePrice(id: string, currentPrice: number): Promise<void> {
    await this.db.query(
      'UPDATE positions SET current_price = $2 WHERE id = $1',
      [id, currentPrice]
    );
  }

  /**
   * Close a position (sell executed)
   */
  async close(
    id: string,
    exitReason: Position['exitReason'],
    pnlSol: number,
    exitTxSignature: string
  ): Promise<void> {
    const status = exitReason === 'emergency' ? 'emergency' :
                   exitReason === 'stop_loss' ? 'stopped' : 'sold';

    await this.db.query(`
      UPDATE positions SET
        status = $2,
        exit_time = $3,
        exit_reason = $4,
        pnl_sol = $5,
        exit_tx_signature = $6
      WHERE id = $1
    `, [
      id,
      status,
      Date.now(),
      exitReason,
      pnlSol,
      exitTxSignature,
    ]);

    console.log(`[PositionStore] Closed position ${id}: ${exitReason} (${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL)`);
  }

  /**
   * Get trades for today (for daily limit check)
   */
  async getTodayTradeCount(): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const result = await this.db.query(
      'SELECT COUNT(*) as count FROM positions WHERE entry_time >= $1',
      [startOfDay.getTime()]
    );
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Get position statistics
   */
  async getStats(): Promise<PositionStats> {
    const activeResult = await this.db.query(
      `SELECT COUNT(*) as count FROM positions WHERE status = 'active'`
    );

    const totalResult = await this.db.query(
      `SELECT
        COUNT(*) as total,
        COALESCE(SUM(pnl_sol), 0) as total_pnl,
        COUNT(*) FILTER (WHERE pnl_sol > 0) as wins,
        COUNT(*) FILTER (WHERE pnl_sol < 0) as losses
      FROM positions WHERE status != 'active'`
    );

    const row = totalResult.rows[0];
    const total = parseInt(row.total, 10);
    const wins = parseInt(row.wins, 10);

    return {
      activeCount: parseInt(activeResult.rows[0].count, 10),
      totalTrades: total,
      totalPnlSol: parseFloat(row.total_pnl) || 0,
      winCount: wins,
      lossCount: parseInt(row.losses, 10),
      winRate: total > 0 ? (wins / total) * 100 : 0,
    };
  }

  /**
   * Get recent closed positions
   */
  async getRecentClosed(limit: number = 20): Promise<Position[]> {
    const result = await this.db.query(
      `SELECT * FROM positions WHERE status != 'active' ORDER BY exit_time DESC LIMIT $1`,
      [limit]
    );
    return result.rows.map(this.rowToPosition);
  }

  /**
   * Check if we already have a position for this token
   */
  async hasActivePosition(tokenAddress: string): Promise<boolean> {
    const result = await this.db.query(
      `SELECT 1 FROM positions WHERE token_address = $1 AND status = 'active'`,
      [tokenAddress]
    );
    return result.rows.length > 0;
  }

  // ============================================================
  // Helpers
  // ============================================================

  private rowToPosition(row: any): Position {
    return {
      id: row.id,
      tokenAddress: row.token_address,
      tokenSymbol: row.token_symbol,
      poolAddress: row.pool_address,
      entryPrice: parseFloat(row.entry_price),
      entrySolAmount: parseFloat(row.entry_sol_amount),
      tokenAmount: parseFloat(row.token_amount),
      stopLossPrice: parseFloat(row.stop_loss_price),
      takeProfitPrice: parseFloat(row.take_profit_price),
      currentPrice: parseFloat(row.current_price),
      status: row.status,
      entryTime: parseInt(row.entry_time, 10),
      exitTime: row.exit_time ? parseInt(row.exit_time, 10) : undefined,
      exitReason: row.exit_reason,
      pnlSol: row.pnl_sol ? parseFloat(row.pnl_sol) : undefined,
      txSignature: row.tx_signature,
      exitTxSignature: row.exit_tx_signature,
      strategy: row.strategy,
    };
  }
}
