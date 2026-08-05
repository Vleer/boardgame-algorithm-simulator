/**
 * American Checkers (English Draughts) and International Draughts engines.
 *
 * Board: row 0 = top (White), last row = bottom (Black / human).
 * Play only on dark squares: (r + c) % 2 === 1.
 */

import { mctsChoose } from "./ai-policy.js";

export const EMPTY = 0;
export const BLACK_MAN = 1;
export const BLACK_KING = 2;
export const WHITE_MAN = 3;
export const WHITE_KING = 4;

export const VARIANTS = {
  american: {
    id: "american",
    size: 8,
    piecesPerSide: 12,
    manBackwardCapture: false,
    flyingKings: false,
    majorityCapture: false,
    /** Promote and end turn immediately when a man reaches the king row (even mid-combo). */
    promoteEndsTurn: true,
  },
  international: {
    id: "international",
    size: 10,
    piecesPerSide: 20,
    manBackwardCapture: true,
    flyingKings: true,
    majorityCapture: true,
    /** Promotion only after the full turn ends on the king row. */
    promoteEndsTurn: false,
  },
};

const DIAG = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

function isDark(r, c) {
  return (r + c) % 2 === 1;
}

function inBounds(size, r, c) {
  return r >= 0 && r < size && c >= 0 && c < size;
}

function idx(size, r, c) {
  return r * size + c;
}

function rc(size, i) {
  return [(i / size) | 0, i % size];
}

export function isBlack(p) {
  return p === BLACK_MAN || p === BLACK_KING;
}

export function isWhite(p) {
  return p === WHITE_MAN || p === WHITE_KING;
}

export function isKing(p) {
  return p === BLACK_KING || p === WHITE_KING;
}

function sameSide(a, b) {
  return (isBlack(a) && isBlack(b)) || (isWhite(a) && isWhite(b));
}

function forwardDirs(piece) {
  if (piece === BLACK_MAN) return [[-1, -1], [-1, 1]];
  if (piece === WHITE_MAN) return [[1, -1], [1, 1]];
  return DIAG.slice();
}

function captureDirs(piece, rules) {
  if (isKing(piece)) return DIAG.slice();
  if (rules.manBackwardCapture) return DIAG.slice();
  return forwardDirs(piece);
}

function kingRow(size, piece) {
  if (isBlack(piece) || piece === BLACK_MAN) return 0;
  return size - 1;
}

function wouldPromote(size, piece, to) {
  if (isKing(piece)) return false;
  const [r] = rc(size, to);
  return r === kingRow(size, piece);
}

function promotePiece(piece) {
  if (piece === BLACK_MAN) return BLACK_KING;
  if (piece === WHITE_MAN) return WHITE_KING;
  return piece;
}

export function createInitialBoard(rules) {
  const size = rules.size;
  const board = new Array(size * size).fill(EMPTY);
  const rows = rules.piecesPerSide / (size / 2);

  // White on top rows
  let placed = 0;
  for (let r = 0; r < size && placed < rules.piecesPerSide; r++) {
    for (let c = 0; c < size && placed < rules.piecesPerSide; c++) {
      if (!isDark(r, c)) continue;
      if (r < rows) {
        board[idx(size, r, c)] = WHITE_MAN;
        placed++;
      }
    }
  }

  // Black on bottom rows
  placed = 0;
  for (let r = size - 1; r >= 0 && placed < rules.piecesPerSide; r--) {
    for (let c = 0; c < size && placed < rules.piecesPerSide; c++) {
      if (!isDark(r, c)) continue;
      if (r >= size - rows) {
        board[idx(size, r, c)] = BLACK_MAN;
        placed++;
      }
    }
  }
  return board;
}

function cloneBoard(board) {
  return board.slice();
}

function applyCapturePath(board, size, from, path, captures, piece) {
  const next = cloneBoard(board);
  next[from] = EMPTY;
  for (const cap of captures) next[cap] = EMPTY;
  const to = path[path.length - 1];
  let finalPiece = piece;
  if (wouldPromote(size, piece, to)) finalPiece = promotePiece(piece);
  next[to] = finalPiece;
  return next;
}

/** Quiet (non-capture) moves from a square. */
function quietMovesFrom(board, size, rules, from) {
  const piece = board[from];
  if (!piece) return [];
  const [r0, c0] = rc(size, from);
  const moves = [];

  if (rules.flyingKings && isKing(piece)) {
    for (const [dr, dc] of DIAG) {
      let r = r0 + dr;
      let c = c0 + dc;
      while (inBounds(size, r, c) && isDark(r, c)) {
        const j = idx(size, r, c);
        if (board[j] !== EMPTY) break;
        moves.push({
          from,
          to: j,
          path: [j],
          captures: [],
          piece,
          promote: wouldPromote(size, piece, j),
        });
        r += dr;
        c += dc;
      }
    }
    return moves;
  }

  // Step men / step kings
  const dirs = isKing(piece) ? DIAG : forwardDirs(piece);
  for (const [dr, dc] of dirs) {
    const r = r0 + dr;
    const c = c0 + dc;
    if (!inBounds(size, r, c) || !isDark(r, c)) continue;
    const j = idx(size, r, c);
    if (board[j] !== EMPTY) continue;
    moves.push({
      from,
      to: j,
      path: [j],
      captures: [],
      piece,
      promote: wouldPromote(size, piece, j),
    });
  }
  return moves;
}

/**
 * Recursively find capture sequences from `from`.
 * `occupied` is a mutable board used during search (captures removed temporarily).
 */
function captureSequencesFrom(board, size, rules, from, piece, capturedSet) {
  const results = [];
  const [r0, c0] = rc(size, from);

  // Mid-combo promotion ends the turn (American)
  if (rules.promoteEndsTurn && wouldPromote(size, piece, from) && capturedSet.size > 0) {
    return results;
  }

  const tryLand = (land, capIdx, workingPiece) => {
    if (capturedSet.has(capIdx)) return;
    const nextCaptured = new Set(capturedSet);
    nextCaptured.add(capIdx);

    // Temporarily clear from + captured for continued search
    const savedFrom = board[from];
    const savedCap = board[capIdx];
    board[from] = EMPTY;
    board[capIdx] = EMPTY;
    board[land] = workingPiece;

    let contPiece = workingPiece;
    let stopForPromotion = false;
    if (!isKing(workingPiece) && wouldPromote(size, workingPiece, land)) {
      if (rules.promoteEndsTurn) {
        contPiece = promotePiece(workingPiece);
        stopForPromotion = true;
      }
      // International: stay a man until end of turn; may continue capturing
    }

    let extensions = [];
    if (!stopForPromotion) {
      extensions = captureSequencesFrom(board, size, rules, land, contPiece, nextCaptured);
    }

    board[land] = EMPTY;
    board[capIdx] = savedCap;
    board[from] = savedFrom;

    if (!extensions.length || stopForPromotion) {
      results.push({
        from: null,
        to: land,
        path: [land],
        captures: [capIdx],
        piece: workingPiece,
        promote: !isKing(workingPiece) && wouldPromote(size, workingPiece, land),
      });
    } else {
      for (const ext of extensions) {
        results.push({
          from: null,
          to: ext.to,
          path: [land, ...ext.path],
          captures: [capIdx, ...ext.captures],
          piece: workingPiece,
          promote:
            ext.promote ||
            (!isKing(workingPiece) && wouldPromote(size, workingPiece, ext.to)),
        });
      }
    }
  };

  if (rules.flyingKings && isKing(piece)) {
    for (const [dr, dc] of DIAG) {
      let r = r0 + dr;
      let c = c0 + dc;
      // slide through empties
      while (inBounds(size, r, c) && isDark(r, c) && board[idx(size, r, c)] === EMPTY) {
        r += dr;
        c += dc;
      }
      if (!inBounds(size, r, c) || !isDark(r, c)) continue;
      const mid = idx(size, r, c);
      const victim = board[mid];
      if (!victim || sameSide(piece, victim) || capturedSet.has(mid)) continue;

      // must land on an empty dark square beyond
      let lr = r + dr;
      let lc = c + dc;
      while (inBounds(size, lr, lc) && isDark(lr, lc) && board[idx(size, lr, lc)] === EMPTY) {
        tryLand(idx(size, lr, lc), mid, piece);
        lr += dr;
        lc += dc;
      }
    }
    return results;
  }

  // Short jumps (men, or American kings)
  for (const [dr, dc] of captureDirs(piece, rules)) {
    const mr = r0 + dr;
    const mc = c0 + dc;
    const lr = r0 + 2 * dr;
    const lc = c0 + 2 * dc;
    if (!inBounds(size, lr, lc) || !isDark(lr, lc)) continue;
    if (!inBounds(size, mr, mc) || !isDark(mr, mc)) continue;
    const mid = idx(size, mr, mc);
    const land = idx(size, lr, lc);
    const victim = board[mid];
    if (!victim || sameSide(piece, victim) || capturedSet.has(mid)) continue;
    if (board[land] !== EMPTY) continue;
    tryLand(land, mid, piece);
  }

  return results;
}

function allCapturesForSide(board, size, rules, blackSide) {
  const moves = [];
  const work = cloneBoard(board);
  for (let i = 0; i < board.length; i++) {
    const p = board[i];
    if (!p) continue;
    if (blackSide && !isBlack(p)) continue;
    if (!blackSide && !isWhite(p)) continue;
    const seqs = captureSequencesFrom(work, size, rules, i, p, new Set());
    for (const s of seqs) {
      moves.push({
        from: i,
        to: s.to,
        path: s.path,
        captures: s.captures,
        piece: p,
        promote: s.promote,
      });
    }
  }
  return moves;
}

function allQuietForSide(board, size, rules, blackSide) {
  const moves = [];
  for (let i = 0; i < board.length; i++) {
    const p = board[i];
    if (!p) continue;
    if (blackSide && !isBlack(p)) continue;
    if (!blackSide && !isWhite(p)) continue;
    moves.push(...quietMovesFrom(board, size, rules, i));
  }
  return moves;
}

export function legalMoves(board, rules, blackSide) {
  const size = rules.size;
  const captures = allCapturesForSide(board, size, rules, blackSide);
  if (captures.length) {
    if (rules.majorityCapture) {
      let max = 0;
      for (const m of captures) max = Math.max(max, m.captures.length);
      return captures.filter((m) => m.captures.length === max);
    }
    return captures;
  }
  return allQuietForSide(board, size, rules, blackSide);
}

export function applyMove(board, rules, move) {
  const size = rules.size;
  const next = cloneBoard(board);
  const piece = next[move.from];
  next[move.from] = EMPTY;
  for (const c of move.captures) next[c] = EMPTY;
  let finalPiece = piece;
  if (move.captures.length) {
    // International: promote only if ending on king row after full sequence
    // American: promoteEndsTurn already reflected by stopping; still promote on landing
    if (!isKing(piece) && wouldPromote(size, piece, move.to)) {
      finalPiece = promotePiece(piece);
    }
  } else if (move.promote || wouldPromote(size, piece, move.to)) {
    finalPiece = promotePiece(piece);
  }
  next[move.to] = finalPiece;
  return next;
}

export function countSide(board) {
  let black = 0;
  let white = 0;
  let blackK = 0;
  let whiteK = 0;
  for (const p of board) {
    if (p === BLACK_MAN) black++;
    else if (p === BLACK_KING) {
      black++;
      blackK++;
    } else if (p === WHITE_MAN) white++;
    else if (p === WHITE_KING) {
      white++;
      whiteK++;
    }
  }
  return { black, white, blackK, whiteK };
}

function evaluate(board, rules, blackPerspective) {
  let score = 0;
  for (const p of board) {
    let v = 0;
    if (p === BLACK_MAN) v = 100;
    else if (p === BLACK_KING) v = 180;
    else if (p === WHITE_MAN) v = -100;
    else if (p === WHITE_KING) v = -180;
    score += v;
  }
  const mobB = legalMoves(board, rules, true).length;
  const mobW = legalMoves(board, rules, false).length;
  score += 3 * (mobB - mobW);
  return blackPerspective ? score : -score;
}

function minimax(board, rules, blackTurn, perspectiveBlack, depth, alpha, beta) {
  const moves = legalMoves(board, rules, blackTurn);
  if (depth === 0 || !moves.length) {
    if (!moves.length) {
      // side to move loses
      const loss = perspectiveBlack === blackTurn ? -100000 : 100000;
      return { score: loss + depth, move: null };
    }
    return { score: evaluate(board, rules, perspectiveBlack), move: null };
  }

  const maximizing = blackTurn === perspectiveBlack;
  let bestMove = moves[0];

  if (maximizing) {
    let best = -Infinity;
    for (const m of moves) {
      const next = applyMove(board, rules, m);
      const { score } = minimax(next, rules, !blackTurn, perspectiveBlack, depth - 1, alpha, beta);
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
    const next = applyMove(board, rules, m);
    const { score } = minimax(next, rules, !blackTurn, perspectiveBlack, depth - 1, alpha, beta);
    if (score < best) {
      best = score;
      bestMove = m;
    }
    beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return { score: best, move: bestMove };
}

export function bestAiMove(board, rules, blackSide = false, depth = 3) {
  const { move } = minimax(board, rules, blackSide, blackSide, depth, -Infinity, Infinity);
  return move;
}

export function scoreDraughtsMove(board, rules, move, blackSide) {
  const next = applyMove(board, rules, move);
  return evaluate(next, rules, blackSide) + move.captures.length * 50;
}

/** Total occupied squares — drives endgame search depth. */
export function pieceCount(board) {
  let n = 0;
  for (const p of board) if (p) n += 1;
  return n;
}

const MATE = 1_000_000;

/**
 * Endgame-aware static eval: promotion progress + king activity.
 * Used when the exact search budget is exhausted before a terminal position.
 */
function endgameEvaluate(board, rules, blackPerspective) {
  const size = rules.size;
  let score = 0;
  for (let i = 0; i < board.length; i++) {
    const p = board[i];
    if (!p) continue;
    const [r, c] = rc(size, i);
    const center = (size - 1) / 2;
    const central = 6 - (Math.abs(r - center) + Math.abs(c - center));
    if (p === BLACK_MAN) {
      score += 100 + (size - 1 - r) * 12;
    } else if (p === WHITE_MAN) {
      score -= 100 + r * 12;
    } else if (p === BLACK_KING) {
      score += 190 + central * 4;
    } else if (p === WHITE_KING) {
      score -= 190 + central * 4;
    }
  }
  const mobB = legalMoves(board, rules, true).length;
  const mobW = legalMoves(board, rules, false).length;
  score += 8 * (mobB - mobW);
  return blackPerspective ? score : -score;
}

/**
 * Exact-ish alpha-beta for sparse boards.
 * Terminal wins/losses use distance-to-mate so shorter mates rank higher.
 * A soft node budget keeps the UI responsive on wider boards.
 */
function endgameSearch(
  board,
  rules,
  blackTurn,
  perspectiveBlack,
  depth,
  ply,
  alpha,
  beta,
  budget
) {
  budget.nodes += 1;
  if (budget.nodes > budget.limit) {
    return {
      score: endgameEvaluate(board, rules, perspectiveBlack),
      move: null,
      cut: true,
    };
  }

  const moves = legalMoves(board, rules, blackTurn);
  if (!moves.length) {
    const lossForMover = perspectiveBlack === blackTurn;
    const score = lossForMover ? -MATE + ply : MATE - ply;
    return { score, move: null, cut: false };
  }

  if (depth <= 0) {
    return {
      score: endgameEvaluate(board, rules, perspectiveBlack),
      move: null,
      cut: false,
    };
  }

  // Prefer captures first — critical for sparse forced lines
  moves.sort((a, b) => b.captures.length - a.captures.length);

  const maximizing = blackTurn === perspectiveBlack;
  let bestMove = moves[0];

  if (maximizing) {
    let best = -Infinity;
    for (const m of moves) {
      const next = applyMove(board, rules, m);
      const { score, cut } = endgameSearch(
        next,
        rules,
        !blackTurn,
        perspectiveBlack,
        depth - 1,
        ply + 1,
        alpha,
        beta,
        budget
      );
      if (score > best) {
        best = score;
        bestMove = m;
      }
      alpha = Math.max(alpha, best);
      if (beta <= alpha || cut) break;
    }
    return { score: best, move: bestMove, cut: false };
  }

  let best = Infinity;
  for (const m of moves) {
    const next = applyMove(board, rules, m);
    const { score, cut } = endgameSearch(
      next,
      rules,
      !blackTurn,
      perspectiveBlack,
      depth - 1,
      ply + 1,
      alpha,
      beta,
      budget
    );
    if (score < best) {
      best = score;
      bestMove = m;
    }
    beta = Math.min(beta, best);
    if (beta <= alpha || cut) break;
  }
  return { score: best, move: bestMove, cut: false };
}

/**
 * Depth scales inversely with piece count: few pieces → deep exact search.
 * `budget` (UI depth slider) stretches the ply limit and node ceiling.
 * Tuned for a few hundred ms to a couple of seconds on a typical laptop.
 */
export function bestEndgameMove(board, rules, blackSide = false, budget = 4) {
  const n = pieceCount(board);
  const b = Math.max(1, budget | 0);
  let depth;
  if (n <= 3) depth = 32 + b * 5;
  else if (n <= 4) depth = 26 + b * 4;
  else if (n <= 5) depth = 20 + b * 3;
  else if (n <= 6) depth = 16 + b * 2;
  else if (n <= 8) depth = 12 + b * 2;
  else if (n <= 10) depth = 8 + b;
  else depth = Math.max(5, b + 2);

  // International 10×10 still branches hard; cap depth a bit when crowded
  if (rules.size >= 10 && n > 8) depth = Math.min(depth, 8 + b);

  // ~0.2M–3M+ nodes depending on slider + sparsity (fine in browser JS)
  const nodeLimit =
    200_000 + b * 280_000 + Math.max(0, 12 - n) * 120_000;
  const searchBudget = { nodes: 0, limit: nodeLimit };
  const { move } = endgameSearch(
    board,
    rules,
    blackSide,
    blackSide,
    depth,
    0,
    -Infinity,
    Infinity,
    searchBudget
  );
  return move ?? bestAiMove(board, rules, blackSide, Math.max(3, b));
}

export function outcomeForBlack(board, rules, blackToMove) {
  const moves = legalMoves(board, rules, blackToMove);
  if (moves.length) return null;
  return blackToMove ? "LOSS" : "WIN";
}

export function moveKey(m) {
  return `${m.from}-${m.to}-${m.captures.join(",")}`;
}

export class DraughtsEngine {
  constructor(variantKey) {
    this.rules = VARIANTS[variantKey];
    if (!this.rules) throw new Error(`Unknown variant ${variantKey}`);
    this.humanIsBlack = true;
    this.reset();
  }

  reset(humanIsBlack = this.humanIsBlack) {
    this.humanIsBlack = humanIsBlack;
    this.board = createInitialBoard(this.rules);
    this.blackTurn = true;
    this.gameOver = false;
    this.winner = null; // WIN/LOSS from human view
    this.lastMove = null; // { from, to }
  }

  isHumanTurn() {
    return this.blackTurn === this.humanIsBlack;
  }

  legal() {
    if (this.gameOver) return [];
    return legalMoves(this.board, this.rules, this.blackTurn);
  }

  legalFrom(from) {
    return this.legal().filter((m) => m.from === from);
  }

  play(move) {
    if (this.gameOver) return "invalid";
    const legal = this.legal();
    const match = legal.find((m) => moveKey(m) === moveKey(move));
    if (!match) return "invalid";
    this.board = applyMove(this.board, this.rules, match);
    this.lastMove = { from: match.from, to: match.to };
    this.blackTurn = !this.blackTurn;
    const next = legalMoves(this.board, this.rules, this.blackTurn);
    if (!next.length) {
      this.gameOver = true;
      // side to move cannot move → that side loses; human wins if it is AI to move
      this.winner = this.isHumanTurn() ? "LOSS" : "WIN";
      return "over";
    }
    return this.isHumanTurn() ? "human" : "ai";
  }

  playAi(depth, policy = "strong") {
    if (this.gameOver || this.isHumanTurn()) return "invalid";
    const d = depth ?? (this.rules.size === 8 ? 4 : 3);
    const blackSide = this.blackTurn;
    const moves = legalMoves(this.board, this.rules, blackSide);
    if (!moves.length) {
      this.gameOver = true;
      this.winner = "WIN";
      return "over";
    }

    let move;
    if (policy === "random") {
      move = moves[(Math.random() * moves.length) | 0];
    } else if (policy === "semirandom") {
      const ranked = moves
        .map((m) => ({ m, s: scoreDraughtsMove(this.board, this.rules, m, blackSide) }))
        .sort((a, b) => b.s - a.s);
      const keep = Math.max(1, Math.ceil(ranked.length / 2));
      move = ranked[(Math.random() * keep) | 0].m;
    } else if (policy === "mcts") {
      const rules = this.rules;
      const d = Math.max(1, (depth ?? 3) | 0);
      move = mctsChoose({
        rootState: { board: this.board.slice(), blackTurn: blackSide },
        legalMoves: (s) => legalMoves(s.board, rules, s.blackTurn),
        apply: (s, m) => ({
          board: applyMove(s.board, rules, m),
          blackTurn: !s.blackTurn,
        }),
        isTerminal: (s) => legalMoves(s.board, rules, s.blackTurn).length === 0,
        reward: (s, perspectiveBlack) => {
          const { black, white } = countSide(s.board);
          const movesLeft = legalMoves(s.board, rules, s.blackTurn);
          if (!movesLeft.length) {
            const moverIsBlack = s.blackTurn;
            const perspectiveWins = moverIsBlack !== perspectiveBlack;
            return perspectiveWins ? 1 : 0;
          }
          const mine = perspectiveBlack ? black : white;
          const theirs = perspectiveBlack ? white : black;
          if (mine > theirs) return 0.7;
          if (mine < theirs) return 0.3;
          return 0.5;
        },
        perspective: blackSide,
        iterations: 120 + d * 100,
        maxPlayoutPly: 40 + d * 8,
        pickPlayoutMove: (_s, ms) => {
          const caps = ms.filter((m) => m.captures && m.captures.length);
          return caps.length ? caps[(Math.random() * caps.length) | 0] : ms[(Math.random() * ms.length) | 0];
        },
      });
    } else if (policy === "endgame") {
      move = bestEndgameMove(this.board, this.rules, blackSide, d);
    } else {
      move = bestAiMove(this.board, this.rules, blackSide, d);
    }

    if (!move) {
      this.gameOver = true;
      this.winner = "WIN";
      return "over";
    }
    return this.play(move);
  }
}
