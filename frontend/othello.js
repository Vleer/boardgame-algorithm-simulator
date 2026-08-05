/** Othello / Reversi engine with shallow minimax AI. */

import { mctsChoose } from "./ai-policy.js";

export const EMPTY = 0;
export const BLACK = 1; // human default
export const WHITE = 2; // AI default

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

export function scoreOthelloMove(board, color, cell) {
  const next = applyMove(board, cell, color);
  if (!next) return -Infinity;
  // 1-ply positional + disc delta
  let score = 0;
  for (let i = 0; i < 64; i++) {
    if (next[i] === color) score += WEIGHTS[i];
    else if (next[i] === opponent(color)) score -= WEIGHTS[i];
  }
  score += 2 * (legalMoves(next, color).length - legalMoves(next, opponent(color)).length);
  return score;
}

export function outcomeForColor(board, humanColor) {
  const { black, white } = countPieces(board);
  if (black === white) return "DRAW";
  const humanWins =
    (humanColor === BLACK && black > white) ||
    (humanColor === WHITE && white > black);
  return humanWins ? "WIN" : "LOSS";
}

export function outcomeForPlayer(board) {
  return outcomeForColor(board, BLACK);
}

export class OthelloEngine {
  constructor() {
    this.humanColor = BLACK;
    this.reset();
  }

  reset(humanColor = this.humanColor) {
    this.humanColor = humanColor;
    this.board = createInitialBoard();
    this.turn = BLACK;
    this.gameOver = false;
    this.lastMove = null;
  }

  get aiColor() {
    return opponent(this.humanColor);
  }

  legalFor(color) {
    return legalMoves(this.board, color);
  }

  legalForCurrent() {
    return legalMoves(this.board, this.turn);
  }

  playHuman(cell) {
    if (this.gameOver || this.turn !== this.humanColor) return "invalid";
    const next = applyMove(this.board, cell, this.humanColor);
    if (!next) return "invalid";
    this.board = next;
    this.lastMove = cell;
    this.turn = this.aiColor;
    return this._afterMove();
  }

  playAi(policy = "strong", depth = 3) {
    if (this.gameOver || this.turn !== this.aiColor) return "invalid";
    const color = this.aiColor;
    const moves = legalMoves(this.board, color);
    if (!moves.length) {
      this.turn = this.humanColor;
      return this._afterMove();
    }

    const d = Math.max(1, depth | 0);
    let move;
    if (policy === "random") {
      move = moves[(Math.random() * moves.length) | 0];
    } else if (policy === "semirandom") {
      const ranked = moves
        .map((m) => ({ m, s: scoreOthelloMove(this.board, color, m) }))
        .sort((a, b) => b.s - a.s);
      const keep = Math.max(1, Math.ceil(ranked.length / 2));
      move = ranked[(Math.random() * keep) | 0].m;
    } else if (policy === "mcts") {
      move = mctsChoose({
        rootState: { board: this.board.slice(), turn: color },
        legalMoves: (s) => legalMoves(s.board, s.turn),
        apply: (s, cell) => {
          const board = applyMove(s.board, cell, s.turn);
          let turn = opponent(s.turn);
          if (!legalMoves(board, turn).length) {
            if (legalMoves(board, s.turn).length) turn = s.turn;
          }
          return { board, turn };
        },
        isTerminal: (s) =>
          !legalMoves(s.board, s.turn).length &&
          !legalMoves(s.board, opponent(s.turn)).length,
        reward: (s, perspective) => {
          const { black, white } = countPieces(s.board);
          const mine = perspective === BLACK ? black : white;
          const theirs = perspective === BLACK ? white : black;
          if (mine > theirs) return 1;
          if (mine < theirs) return 0;
          return 0.5;
        },
        perspective: color,
        iterations: 120 + d * 100,
        maxPlayoutPly: 40 + d * 8,
      });
    } else {
      move = bestAiMove(this.board, color, d);
    }

    this.board = applyMove(this.board, move, color);
    this.lastMove = move;
    this.turn = this.humanColor;
    return this._afterMove();
  }

  _afterMove() {
    const cur = legalMoves(this.board, this.turn);
    if (cur.length) {
      return this.turn === this.aiColor ? "ai" : "continue";
    }

    const other = opponent(this.turn);
    const alt = legalMoves(this.board, other);
    if (!alt.length) {
      this.gameOver = true;
      return "over";
    }
    this.turn = other;
    return this.turn === this.aiColor ? "ai" : "pass";
  }
}
