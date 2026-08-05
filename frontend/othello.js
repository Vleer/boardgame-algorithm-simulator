/** Othello / Reversi engine with shallow minimax AI. */

export const EMPTY = 0;
export const BLACK = 1; // human
export const WHITE = 2; // AI

const DIRS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

// Classic positional weights — corners are gold, X-squares are poison
const WEIGHTS = [
  120, -20, 20, 5, 5, 20, -20, 120,
  -20, -40, -5, -5, -5, -5, -40, -20,
  20, -5, 15, 3, 3, 15, -5, 20,
  5, -5, 3, 3, 3, 3, -5, 5,
  5, -5, 3, 3, 3, 3, -5, 5,
  20, -5, 15, 3, 3, 15, -5, 20,
  -20, -40, -5, -5, -5, -5, -40, -20,
  120, -20, 20, 5, 5, 20, -20, 120,
];

function idx(r, c) {
  return r * 8 + c;
}

function inBounds(r, c) {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

function opponent(color) {
  return color === BLACK ? WHITE : BLACK;
}

function cloneBoard(board) {
  return board.slice();
}

export function createInitialBoard() {
  const board = new Array(64).fill(EMPTY);
  board[idx(3, 3)] = WHITE;
  board[idx(3, 4)] = BLACK;
  board[idx(4, 3)] = BLACK;
  board[idx(4, 4)] = WHITE;
  return board;
}

function flipsFor(board, cell, color) {
  const r0 = (cell / 8) | 0;
  const c0 = cell % 8;
  if (board[cell] !== EMPTY) return [];

  const opp = opponent(color);
  const flips = [];

  for (const [dr, dc] of DIRS) {
    let r = r0 + dr;
    let c = c0 + dc;
    const line = [];
    while (inBounds(r, c) && board[idx(r, c)] === opp) {
      line.push(idx(r, c));
      r += dr;
      c += dc;
    }
    if (line.length && inBounds(r, c) && board[idx(r, c)] === color) {
      flips.push(...line);
    }
  }
  return flips;
}

export function legalMoves(board, color) {
  const moves = [];
  for (let i = 0; i < 64; i++) {
    if (flipsFor(board, i, color).length) moves.push(i);
  }
  return moves;
}

export function applyMove(board, cell, color) {
  const flips = flipsFor(board, cell, color);
  if (!flips.length) return null;
  const next = cloneBoard(board);
  next[cell] = color;
  for (const f of flips) next[f] = color;
  return next;
}

export function countPieces(board) {
  let black = 0;
  let white = 0;
  for (const v of board) {
    if (v === BLACK) black++;
    else if (v === WHITE) white++;
  }
  return { black, white };
}

function evaluate(board, perspective) {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    if (board[i] === perspective) score += WEIGHTS[i];
    else if (board[i] === opponent(perspective)) score -= WEIGHTS[i];
  }
  const myMoves = legalMoves(board, perspective).length;
  const oppMoves = legalMoves(board, opponent(perspective)).length;
  score += 4 * (myMoves - oppMoves);
  return score;
}

function minimax(board, color, perspective, depth, alpha, beta) {
  const moves = legalMoves(board, color);
  const opp = opponent(color);

  if (depth === 0) {
    return { score: evaluate(board, perspective), move: -1 };
  }

  if (!moves.length) {
    if (!legalMoves(board, opp).length) {
      const { black, white } = countPieces(board);
      const mine = perspective === BLACK ? black : white;
      const theirs = perspective === BLACK ? white : black;
      if (mine > theirs) return { score: 10000, move: -1 };
      if (mine < theirs) return { score: -10000, move: -1 };
      return { score: 0, move: -1 };
    }
    return minimax(board, opp, perspective, depth - 1, alpha, beta);
  }

  const maximizing = color === perspective;
  let bestMove = moves[0];

  if (maximizing) {
    let best = -Infinity;
    for (const m of moves) {
      const next = applyMove(board, m, color);
      const { score } = minimax(next, opp, perspective, depth - 1, alpha, beta);
      if (score > best) {
        best = score;
        bestMove = m;
      }
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return { score: best, move: bestMove };
  }

  let best = Infinity;
  for (const m of moves) {
    const next = applyMove(board, m, color);
    const { score } = minimax(next, opp, perspective, depth - 1, alpha, beta);
    if (score < best) {
      best = score;
      bestMove = m;
    }
    beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return { score: best, move: bestMove };
}

export function bestAiMove(board, color = WHITE, depth = 3) {
  const { move } = minimax(board, color, color, depth, -Infinity, Infinity);
  return move;
}

export function outcomeForPlayer(board) {
  const { black, white } = countPieces(board);
  if (black > white) return "WIN";
  if (black < white) return "LOSS";
  return "DRAW";
}

export class OthelloEngine {
  constructor() {
    this.reset();
  }

  reset() {
    this.board = createInitialBoard();
    this.turn = BLACK;
    this.gameOver = false;
  }

  legalForCurrent() {
    return legalMoves(this.board, this.turn);
  }

  /** Player (black) places at cell. Returns status: continue|ai|pass|over|invalid */
  playHuman(cell) {
    if (this.gameOver || this.turn !== BLACK) return "invalid";
    const next = applyMove(this.board, cell, BLACK);
    if (!next) return "invalid";
    this.board = next;
    this.turn = WHITE;
    return this._afterMove();
  }

  playAi() {
    if (this.gameOver || this.turn !== WHITE) return "invalid";
    const moves = legalMoves(this.board, WHITE);
    if (!moves.length) {
      this.turn = BLACK;
      return this._afterMove();
    }
    const move = bestAiMove(this.board, WHITE, 3);
    this.board = applyMove(this.board, move, WHITE);
    this.turn = BLACK;
    return this._afterMove();
  }

  _afterMove() {
    const cur = legalMoves(this.board, this.turn);
    if (cur.length) return this.turn === WHITE ? "ai" : "continue";

    const other = opponent(this.turn);
    const alt = legalMoves(this.board, other);
    if (!alt.length) {
      this.gameOver = true;
      return "over";
    }
    this.turn = other;
    return this.turn === WHITE ? "ai" : "pass";
  }
}
