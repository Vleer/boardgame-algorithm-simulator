/** Shared move-selection policies for board-game AIs. */

export function pickRandom(items) {
  if (!items.length) return null;
  return items[(Math.random() * items.length) | 0];
}

/**
 * Semi-random: score every candidate, keep the better half (by score),
 * then pick uniformly among that shortlist.
 * Strong moves dominate, but noise remains — unlike pure greedy/minimax.
 */
export function pickSemiRandom(items, scoreFn) {
  if (!items.length) return null;
  if (items.length === 1) return items[0];

  const ranked = items
    .map((item) => ({ item, score: scoreFn(item) }))
    .sort((a, b) => b.score - a.score);

  const keep = Math.max(1, Math.ceil(ranked.length / 2));
  const shortlist = ranked.slice(0, keep).map((r) => r.item);
  return pickRandom(shortlist);
}

/**
 * Monte Carlo Tree Search (UCB1).
 *
 * Values are always stored from the root player's (AI) perspective so UCB
 * maximization is correct on every node. (An earlier negation-on-backup
 * path inverted child scores while still maximizing UCB — that made the
 * search prefer moves that helped the opponent.)
 */
export function mctsChoose({
  rootState,
  legalMoves,
  apply,
  isTerminal,
  reward,
  perspective,
  iterations = 96,
  c = Math.SQRT2,
  maxPlayoutPly = 48,
  /** Optional: prefer some moves during random rollouts (e.g. captures). */
  pickPlayoutMove = null,
}) {
  const rootMoves = legalMoves(rootState);
  if (!rootMoves.length) return null;
  if (rootMoves.length === 1) return rootMoves[0];

  function cloneNode(state, move, parent) {
    return {
      state,
      move,
      parent,
      children: [],
      untried: legalMoves(state).slice(),
      visits: 0,
      value: 0,
    };
  }

  const root = cloneNode(rootState, null, null);

  function ucb(node) {
    if (node.visits === 0) return Infinity;
    const exploit = node.value / node.visits;
    const explore = c * Math.sqrt(Math.log(node.parent.visits) / node.visits);
    return exploit + explore;
  }

  function select(node) {
    let cur = node;
    while (!cur.untried.length && cur.children.length) {
      cur = cur.children.reduce((a, b) => (ucb(a) >= ucb(b) ? a : b));
    }
    return cur;
  }

  function expand(node) {
    if (!node.untried.length) return node;
    const i = (Math.random() * node.untried.length) | 0;
    const move = node.untried.splice(i, 1)[0];
    const next = apply(node.state, move);
    const child = cloneNode(next, move, node);
    node.children.push(child);
    return child;
  }

  function playout(state) {
    let s = state;
    for (let ply = 0; ply < maxPlayoutPly; ply++) {
      if (isTerminal(s)) break;
      const moves = legalMoves(s);
      if (!moves.length) break;
      const choice = pickPlayoutMove
        ? pickPlayoutMove(s, moves)
        : pickRandom(moves);
      s = apply(s, choice);
    }
    return reward(s, perspective);
  }

  function backup(node, rewardForAi) {
    let cur = node;
    while (cur) {
      cur.visits += 1;
      // Always accumulate from the root AI's perspective
      cur.value += rewardForAi;
      cur = cur.parent;
    }
  }

  for (let i = 0; i < iterations; i++) {
    const leaf = expand(select(root));
    const value = playout(leaf.state);
    backup(leaf, value);
  }

  // Most visits, break ties by AI win-rate
  let best = root.children[0];
  for (const ch of root.children) {
    if (ch.visits > best.visits) best = ch;
    else if (
      ch.visits === best.visits &&
      ch.value / Math.max(1, ch.visits) > best.value / Math.max(1, best.visits)
    ) {
      best = ch;
    }
  }
  return best.move;
}

export const RANDOM_ALGO = {
  name: "Random",
  text: "Pure chance: every currently legal move is equally likely. No evaluation, no search — useful as a baseline opponent and for stressing UI / rule code with noisy play.",
};

export const SEMIRANDOM_ALGO = {
  name: "Semi-random",
  text: "Each legal move gets a quick heuristic score (material, mobility, or 1-ply value). Moves are sorted and the weaker half is discarded; one of the remaining stronger moves is chosen at random. Play is usually sensible but still unpredictable — unlike full minimax, which always picks a single best line.",
};

export const MCTS_ALGO = {
  name: "MCTS",
  text: "Monte Carlo Tree Search with UCB1. From the current position it grows a tree: select a promising leaf, expand one move, run a playout to a cutoff, then back up the result from the AI’s point of view. Iteration budget controls strength; capture-biased rollouts help on draughts. Still weaker than exact search in sparse endgames—use Endgame Solver there.",
};
