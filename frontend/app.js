import init, { TicTacToeEngine } from "./pkg/tictactoe_wasm.js";
import {
  OthelloEngine,
  BLACK,
  WHITE,
  countPieces,
  outcomeForColor,
} from "./othello.js";
import {
  DraughtsEngine,
  countSide,
  isBlack,
  isKing,
  BLACK_MAN,
  BLACK_KING,
  WHITE_MAN,
  WHITE_KING,
} from "./draughts.js";
import { RANDOM_ALGO, SEMIRANDOM_ALGO, MCTS_ALGO } from "./ai-policy.js";

const POLICY_CODE = { strong: 0, random: 1, semirandom: 2, mcts: 3 };

function withRandomAlgos(algorithms) {
  return {
    ...algorithms,
    mcts: MCTS_ALGO,
    random: RANDOM_ALGO,
    semirandom: SEMIRANDOM_ALGO,
  };
}

const GAME_META = {
  tictactoe: {
    hint: "Wasm engine · local AI · verified finish",
    algorithms: withRandomAlgos({
      minimax: {
        name: "Minimax",
        text: "The AI explores every legal future by alternating maximizing (AI) and minimizing (you) scores. Wins score high with a depth penalty so faster wins are preferred; losses are inverted. On a 3×3 board the full tree is tiny, so every reply is optimal—unbeatable play.",
      },
      bitboards: {
        name: "Bitboards",
        text: "The board is two 9-bit integers: one mask for X, one for O. A move is a single bit set with OR; occupancy is the bitwise OR of both masks. This keeps state in registers and makes legality checks a handful of CPU instructions inside Wasm.",
      },
      winmasks: {
        name: "Win Masks",
        text: "Eight constant bit patterns encode the rows, columns, and diagonals. A side wins when (mask & pattern) == pattern for any pattern—pure bitwise ANDs, no loops over cells. The same predicates drive both the live engine and server-side replay verification.",
      },
    }),
  },
  othello: {
    hint: "8×8 reversi · choose color · AI policy selectable",
    algorithms: withRandomAlgos({
      flipping: {
        name: "Line Flipping",
        text: "A legal move must sandwich one or more opponent discs between your new disc and another of yours along a row, column, or diagonal. All sandwiched discs flip color. If a side has no legal move, it passes; when both cannot move, the game ends.",
      },
      positional: {
        name: "Positional Weights",
        text: "Corners are extremely strong and never flip once taken; squares adjacent to empty corners (X-squares) are dangerous. The AI scores boards with a classic weight matrix that prizes corners and edges while punishing weak near-corner placements.",
      },
      alphabeta: {
        name: "Alpha-Beta Minimax",
        text: "Othello’s branching factor is larger than Tic-Tac-Toe, so the AI searches a few plies with alpha-beta pruning. Mobility (how many moves you leave yourself versus the opponent) is mixed into the heuristic so mid-game control matters, not only raw disc count.",
      },
    }),
  },
  checkers: {
    hint: "American / English Draughts · 8×8 · step kings · forward captures only",
    algorithms: withRandomAlgos({
      endgame: {
        name: "Endgame Solver",
        text: "When few pieces remain, Monte Carlo playouts rarely stumble into the thin forced wins that decide endings. This policy switches to deep alpha-beta with distance-to-mate scoring: wins and losses are exact when the tree bottoms out, and shorter mates outrank longer ones. Search depth scales up as the board empties (roughly ≤6–8 pieces), with a soft node budget so the UI stays responsive. Promotion progress and king activity fill in only when the budget cuts a non-terminal leaf.",
      },
      stepkings: {
        name: "Step Kings",
        text: "Kings move and jump only one diagonal square at a time—forward or backward. There are no flying kings, so late-game technique is about tempo, opposition, and carefully shepherded breakthroughs rather than long-range snipes.",
      },
      forwardonly: {
        name: "Forward-Only Men",
        text: "Men move and capture strictly forward. Combined with immediate promotion that ends the turn on the king row, multi-jump routes are shorter and more positional than in International Draughts.",
      },
      freecapture: {
        name: "Free Capture Choice",
        text: "Capturing is mandatory when available, but any legal capture sequence may be chosen—there is no majority-capture obligation. The AI still prefers richer captures via search evaluation when several options exist.",
      },
    }),
  },
  draughts: {
    hint: "International Draughts · 10×10 · flying kings · majority capture",
    algorithms: withRandomAlgos({
      endgame: {
        name: "Endgame Solver",
        text: "Sparse International endings punish Monte Carlo: flying-king shots and majority lines are rare in random playouts but decisive in exact calculation. This solver runs deep alpha-beta with mate-distance scores, pushing ply hard once only a handful of discs remain, ordering captures first. The depth slider stretches both ply and the node ceiling; with many pieces left it still searches, just less aggressively than in a true ending.",
      },
      flying: {
        name: "Flying Kings",
        text: "Kings slide any distance along open diagonals and capture by leaping an opponent disc, landing on any empty square beyond. This creates long combinatorial shots that dominate International tactics.",
      },
      majority: {
        name: "Majority Capture",
        text: "When several capture sequences exist, only those with the maximum number of captured pieces are legal. Choosing a shorter capture is simply forbidden—calculation must find the longest forced combination.",
      },
      delayedpromo: {
        name: "End-of-Turn Promotion",
        text: "A man that passes the king row mid-combination stays a man until the turn ends. Only landing on the back rank when the sequence finishes promotes it—enabling famous “capture through the king-row” tactics.",
      },
    }),
  },
};

const options = {
  tictactoe: {
    color: "X",
    thinkMs: 200,
    depth: 4,
    showHints: true,
    soundless: true,
    flipBoard: false,
    setupMode: false,
    sideToMove: "human",
  },
  othello: {
    color: "black",
    thinkMs: 200,
    depth: 3,
    showHints: true,
    autoPass: true,
    flipBoard: false,
    setupMode: false,
    sideToMove: "black",
  },
  checkers: {
    color: "black",
    thinkMs: 150,
    depth: 5,
    showHints: true,
    mustSelect: true,
    flipBoard: false,
    setupMode: false,
    sideToMove: "black",
  },
  draughts: {
    color: "black",
    thinkMs: 150,
    depth: 4,
    showHints: true,
    showCounts: true,
    flipBoard: false,
    setupMode: false,
    sideToMove: "black",
  },
};

function emptyHistory() {
  return { past: [], future: [] };
}

const history = {
  tictactoe: emptyHistory(),
  othello: emptyHistory(),
  checkers: emptyHistory(),
  draughts: emptyHistory(),
};

/** @type {number | null} */
let tttLastMove = null;

function cycleValue(current, chain) {
  const i = chain.indexOf(current);
  if (i < 0) return chain[1] ?? chain[0];
  return chain[(i + 1) % chain.length];
}

function syncSideToggles(gameId) {
  const games = gameId ? [gameId] : Object.keys(options);
  games.forEach((g) => {
    const root = document.querySelector(`[data-side-for="${g}"]`);
    if (!root) return;
    root.querySelectorAll("[data-side]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.side === options[g].sideToMove);
    });
  });
}

function pushHistory(gameId, snapshot) {
  history[gameId].past.push(snapshot);
  history[gameId].future = [];
  syncUndoRedoButtons(gameId);
}

function syncUndoRedoButtons(gameId) {
  const map = {
    tictactoe: ["ttt-undo", "ttt-redo"],
    othello: ["othello-undo", "othello-redo"],
    checkers: ["checkers-undo", "checkers-redo"],
    draughts: ["draughts-undo", "draughts-redo"],
  };
  const ids = map[gameId];
  if (!ids) return;
  const [undoId, redoId] = ids;
  const undoBtn = document.getElementById(undoId);
  const redoBtn = document.getElementById(redoId);
  if (undoBtn) undoBtn.disabled = history[gameId].past.length === 0;
  if (redoBtn) redoBtn.disabled = history[gameId].future.length === 0;
}

function clearHistory(gameId) {
  history[gameId] = emptyHistory();
  syncUndoRedoButtons(gameId);
}

/** @type {Record<string, 'strong'|'random'|'semirandom'|'mcts'|'endgame'>} */
const aiPolicy = {
  tictactoe: "strong",
  othello: "strong",
  checkers: "strong",
  draughts: "strong",
};

const AI_SELECTORS = new Set([
  "random",
  "semirandom",
  "mcts",
  "endgame",
  "minimax",
  "alphabeta",
  "positional",
  "strong",
]);

let currentGame = "tictactoe";
let selectedAlgo = null;

const algoList = document.getElementById("algo-list");
const explain = document.getElementById("explain");
const explainName = document.getElementById("explain-name");
const explainText = document.getElementById("explain-text");
const explainToggle = document.getElementById("explain-toggle");
const gameHint = document.getElementById("game-hint");
const gamesRail = document.getElementById("games-rail");
const algoRail = document.getElementById("algo-rail");

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readOptionsFromDom() {
  document.querySelectorAll("[data-opt]").forEach((el) => {
    const game = el.dataset.opt;
    const key = el.dataset.key;
    if (!options[game]) return;
    if (el.type === "checkbox") options[game][key] = el.checked;
    else if (key === "thinkMs" || key === "depth") options[game][key] = parseInt(el.value, 10) || 1;
    else options[game][key] = el.value;
  });
}

function mctsIterations(depth) {
  return 120 + Math.max(1, depth) * 100;
}

function depthLabel(gameId, depth) {
  const policy = aiPolicy[gameId];
  if (policy === "mcts") {
    return `${depth} · ~${mctsIterations(depth)} sims`;
  }
  if (policy === "endgame") {
    return `${depth} · sparse exact`;
  }
  return `${depth} ply`;
}

function syncDepthControls(gameId = currentGame) {
  const policy = aiPolicy[gameId];
  const visible =
    gameId === "tictactoe"
      ? policy === "mcts"
      : policy !== "random" && policy !== "semirandom";

  document.querySelectorAll(`[data-depth-for="${gameId}"]`).forEach((wrap) => {
    wrap.classList.toggle("visible", visible);
    const slider = wrap.querySelector('input[type="range"]');
    const valueEl = wrap.querySelector("[data-depth-value]");
    const labelEl = wrap.querySelector("[data-depth-label]");
    if (!slider) return;
    const depth = options[gameId].depth ?? parseInt(slider.value, 10);
    slider.value = String(depth);
    if (valueEl) valueEl.textContent = depthLabel(gameId, depth);
    if (labelEl) {
      labelEl.textContent =
        policy === "mcts"
          ? "MCTS budget"
          : policy === "endgame"
            ? "Solve budget"
            : "Search depth";
    }
  });
}

function currentDepth(gameId = currentGame) {
  return Math.max(1, options[gameId].depth | 0);
}

function applyBoardChrome(gameId = currentGame) {
  const opt = options[gameId];
  const panel = document.getElementById(`play-${gameId}`);
  const details = panel?.querySelector(".options");
  details?.classList.toggle("setup-on", !!opt.setupMode);
  panel?.classList.toggle("setup-on", !!opt.setupMode);

  const board =
    gameId === "tictactoe"
      ? document.getElementById("ttt-board")
      : gameId === "othello"
        ? document.getElementById("othello-board")
        : gameId === "checkers"
          ? document.getElementById("checkers-board")
          : document.getElementById("draughts-board");
  board?.classList.toggle("board-flipped", !!opt.flipBoard);
}

function syncSetupStatus(gameId) {
  if (!options[gameId].setupMode) return;
  const el =
    gameId === "tictactoe"
      ? tttStatus
      : gameId === "othello"
        ? othelloStatus
        : gameId === "checkers"
          ? document.getElementById("checkers-status")
          : document.getElementById("draughts-status");
  if (el) el.textContent = "Setup mode — left: white/O · right: black/X · turn Setup off to play";
}

document.querySelectorAll("[data-side-for]").forEach((root) => {
  const game = root.dataset.sideFor;
  root.querySelectorAll("[data-side]").forEach((btn) => {
    btn.addEventListener("click", () => {
      options[game].sideToMove = btn.dataset.side;
      syncSideToggles(game);
    });
  });
});

document.querySelectorAll("[data-opt]").forEach((el) => {
  const handler = () => {
    const game = el.dataset.opt;
    const key = el.dataset.key;
    const wasSetup = options[game]?.setupMode;
    readOptionsFromDom();
    applyBoardChrome(game);

    if (key === "color") {
      if (!options[game].setupMode) restartCurrentGame();
      else refreshCurrentHints();
      return;
    }

    if (key === "setupMode") {
      if (options[game].setupMode) {
        clearHistory(game);
        if (game === "tictactoe") {
          tttBusy = false;
          tttGameOver = false;
          tttLastMove = null;
        }
        if (game === "othello") {
          othelloBusy = false;
          othello.lastMove = null;
        }
        if (game === "checkers") checkersUi?.render();
        if (game === "draughts") draughtsUi?.render();
        syncSetupStatus(game);
        refreshCurrentHints();
      } else if (wasSetup) {
        leaveSetup(game);
      }
      return;
    }

    if (key === "depth") {
      syncDepthControls(game);
      return;
    }

    if (key === "flipBoard") {
      applyBoardChrome(game);
      return;
    }

    if (currentGame === game) refreshCurrentHints();
  };
  el.addEventListener("change", handler);
  if (el.dataset.key === "depth") el.addEventListener("input", handler);
});

document.querySelectorAll("[data-clear]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const game = btn.dataset.clear;
    clearBoard(game);
  });
});

function clearBoard(game) {
  if (options[game]?.setupMode) {
    if (game === "tictactoe") pushHistory(game, snapshotTtt());
    else if (game === "othello") pushHistory(game, snapshotOthello());
    else if (game === "checkers") pushHistory(game, checkersUi.snapshot());
    else if (game === "draughts") pushHistory(game, draughtsUi.snapshot());
  }
  if (game === "tictactoe" && tttEngine) {
    tttEngine.clear_board();
    tttGameOver = false;
    tttLastMove = null;
    renderTtt();
  } else if (game === "othello") {
    othello.board = othello.board.map(() => 0);
    othello.gameOver = false;
    othello.lastMove = null;
    renderOthello();
  } else if (game === "checkers") {
    checkersUi.clearSetup();
  } else if (game === "draughts") {
    draughtsUi.clearSetup();
  }
  syncSetupStatus(game);
}

async function leaveSetup(game) {
  readOptionsFromDom();
  clearHistory(game);
  if (game === "tictactoe") {
    tttGameOver = false;
    tttBusy = false;
    tttLastMove = null;
    try {
      await mintSession();
    } catch (_) {
      /* offline ok in setup exit */
    }
    renderTtt();
    if (options.tictactoe.sideToMove === "ai") {
      tttStatus.textContent = "AI to move from custom position…";
      tttBusy = true;
      await delay(options.tictactoe.thinkMs);
      const code = tttEngine.play_ai(tttPolicyCode(), currentDepth("tictactoe"));
      const seq = tttEngine.get_move_sequence();
      if (seq.length) tttLastMove = parseInt(seq[seq.length - 1], 10);
      renderTtt();
      if (code !== 0) {
        tttGameOver = true;
        await finishTtt(code === 2 ? "LOSS" : "DRAW");
      } else {
        tttStatus.textContent = `Your move (${options.tictactoe.color})`;
      }
      tttBusy = false;
    } else {
      tttStatus.textContent = `Your move (${options.tictactoe.color}) — custom position`;
    }
  } else if (game === "othello") {
    othello.humanColor = othelloHumanColor();
    othello.gameOver = false;
    othello.lastMove = null;
    othello.turn =
      options.othello.sideToMove === "white" ? WHITE : BLACK;
    othelloBusy = false;
    renderOthello();
    if (othello.turn === othello.aiColor) await runOthelloAi();
    else {
      const label = othello.humanColor === BLACK ? "Black" : "White";
      othelloStatus.textContent = `Your move (${label}) — custom position`;
    }
  } else if (game === "checkers") {
    checkersUi.applySetupExit();
  } else if (game === "draughts") {
    draughtsUi.applySetupExit();
  }
}

function wireCollapse(rail, button, collapsedGlyph, expandedGlyph) {
  button.addEventListener("click", () => {
    const collapsed = rail.classList.toggle("collapsed");
    button.setAttribute("aria-expanded", String(!collapsed));
    button.textContent = collapsed ? collapsedGlyph : expandedGlyph;
    button.title = collapsed ? "Expand" : "Collapse";
  });
}

wireCollapse(gamesRail, document.getElementById("games-toggle"), "›", "‹");
wireCollapse(algoRail, document.getElementById("algo-toggle"), "‹", "›");

explainToggle.addEventListener("click", () => {
  const collapsed = explain.classList.toggle("collapsed");
  explainToggle.setAttribute("aria-expanded", String(!collapsed));
  explainToggle.textContent = collapsed ? "▴" : "▾";
  explainToggle.title = collapsed ? "Expand explanation" : "Collapse explanation";
});

function resetExplain() {
  explain.classList.add("empty");
  explain.classList.remove("collapsed");
  explainName.textContent = "Select one →";
  explainText.textContent = "";
  explainToggle.textContent = "▾";
  explainToggle.setAttribute("aria-expanded", "true");
  selectedAlgo = null;
}

function renderAlgorithms(gameId) {
  const algos = GAME_META[gameId].algorithms;
  algoList.innerHTML = "";
  Object.entries(algos).forEach(([id, algo]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "nav-item";
    btn.dataset.algo = id;
    btn.textContent = algo.name;
    if (id === "random" || id === "semirandom" || id === "mcts" || id === "endgame") {
      if (aiPolicy[gameId] === id) btn.classList.add("active");
    } else if (
      aiPolicy[gameId] === "strong" &&
      (id === "minimax" || id === "alphabeta") &&
      !algoList.querySelector(".active")
    ) {
      // leave inactive until clicked; policy still strong
    }
    btn.addEventListener("click", () => {
      algoList.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedAlgo = id;
      explainName.textContent = algo.name;
      explainText.textContent = algo.text;
      explain.classList.remove("empty", "collapsed");
      explainToggle.setAttribute("aria-expanded", "true");
      explainToggle.textContent = "▾";

      if (id === "random" || id === "semirandom" || id === "mcts" || id === "endgame") {
        aiPolicy[gameId] = id;
      } else if (AI_SELECTORS.has(id)) {
        aiPolicy[gameId] = "strong";
      }
      syncDepthControls(gameId);
    });
    algoList.appendChild(btn);
  });
  resetExplain();
}

function switchGame(gameId) {
  if (!GAME_META[gameId] || gameId === currentGame) return;
  currentGame = gameId;
  document.querySelectorAll("[data-game]").forEach((b) => {
    b.classList.toggle("active", b.dataset.game === gameId);
  });
  document.querySelectorAll(".play").forEach((p) => {
    p.classList.toggle("active", p.dataset.panel === gameId);
  });
  gameHint.textContent = GAME_META[gameId].hint;
  renderAlgorithms(gameId);
  syncDepthControls(gameId);
  restartCurrentGame();
}

function restartCurrentGame() {
  readOptionsFromDom();
  if (currentGame === "tictactoe") startTtt();
  if (currentGame === "othello") startOthello();
  if (currentGame === "checkers") checkersUi.start();
  if (currentGame === "draughts") draughtsUi.start();
}

function refreshCurrentHints() {
  if (currentGame === "tictactoe") renderTtt();
  if (currentGame === "othello") renderOthello();
  if (currentGame === "checkers") checkersUi.render();
  if (currentGame === "draughts") draughtsUi.render();
}

document.querySelectorAll("[data-game]").forEach((btn) => {
  btn.addEventListener("click", () => switchGame(btn.dataset.game));
});

/* ——— Tic-Tac-Toe ——— */
let tttEngine;
let sessionData;
let tttGameOver = false;
let tttBusy = false;
const tttCells = document.querySelectorAll("#ttt-board .cell");
const tttStatus = document.getElementById("ttt-status");
const tttBoardEl = document.getElementById("ttt-board");

async function mintSession() {
  const res = await fetch("/api/game/start", { method: "POST" });
  if (!res.ok) throw new Error("Failed to start session");
  sessionData = await res.json();
}

function tttPolicyCode() {
  return POLICY_CODE[aiPolicy.tictactoe] ?? 0;
}

function snapshotTtt() {
  return {
    player: tttEngine.get_player_bits(),
    ai: tttEngine.get_ai_bits(),
    history: tttEngine.get_move_sequence(),
    gameOver: tttGameOver,
    lastMove: tttLastMove,
  };
}

function restoreTtt(snap) {
  tttEngine.load_state(snap.player, snap.ai, snap.history);
  tttGameOver = !!snap.gameOver;
  tttLastMove = snap.lastMove ?? null;
  renderTtt();
}

function tttMarkAt(i) {
  const bit = 1 << i;
  const humanIsX = options.tictactoe.color === "X";
  if (tttEngine.get_player_bits() & bit) return humanIsX ? "X" : "O";
  if (tttEngine.get_ai_bits() & bit) return humanIsX ? "O" : "X";
  return "";
}

function tttOwnerForMark(mark) {
  if (!mark) return 0;
  const humanIsX = options.tictactoe.color === "X";
  if (mark === "X") return humanIsX ? 1 : 2;
  return humanIsX ? 2 : 1;
}

function paintTttCell(idx, side) {
  const chain = side === "white" ? ["", "O"] : ["", "X"];
  const next = cycleValue(tttMarkAt(idx), chain);
  tttEngine.set_cell(idx, tttOwnerForMark(next));
  tttLastMove = null;
  tttGameOver = false;
}

function renderTtt() {
  applyBoardChrome("tictactoe");
  const humanIsX = options.tictactoe.color === "X";
  const pBits = tttEngine.get_player_bits();
  const aBits = tttEngine.get_ai_bits();
  const setup = options.tictactoe.setupMode;
  tttCells.forEach((cell, i) => {
    const bit = 1 << i;
    cell.classList.remove("filled", "x", "o", "locked", "last-move");
    if (pBits & bit) {
      cell.textContent = humanIsX ? "X" : "O";
      cell.classList.add("filled", humanIsX ? "x" : "o");
    } else if (aBits & bit) {
      cell.textContent = humanIsX ? "O" : "X";
      cell.classList.add("filled", humanIsX ? "o" : "x");
    } else {
      cell.textContent = "";
    }
    if (tttLastMove === i && !setup) cell.classList.add("last-move");
    if (tttGameOver && !setup) cell.classList.add("locked");
    cell.style.cursor =
      setup ||
      (options.tictactoe.showHints && !tttGameOver && !(pBits & bit) && !(aBits & bit))
        ? "pointer"
        : "";
  });
  syncUndoRedoButtons("tictactoe");
}

async function maybeAiOpen() {
  if (options.tictactoe.color === "X") return;
  tttStatus.textContent = "AI opens…";
  await delay(options.tictactoe.thinkMs);
  const code = tttEngine.play_ai(tttPolicyCode(), currentDepth("tictactoe"));
  const seq = tttEngine.get_move_sequence();
  if (seq.length) tttLastMove = parseInt(seq[seq.length - 1], 10);
  renderTtt();
  if (code !== 0) {
    tttGameOver = true;
    const outcome = code === 2 ? "LOSS" : "DRAW";
    await finishTtt(outcome);
  }
}

async function startTtt() {
  if (!tttEngine) return;
  tttBusy = true;
  tttGameOver = false;
  tttLastMove = null;
  clearHistory("tictactoe");
  tttStatus.textContent = "Starting session...";
  tttEngine.reset();
  renderTtt();
  try {
    await mintSession();
    await maybeAiOpen();
    if (!tttGameOver) {
      tttStatus.textContent = `Game Ready — You are ${options.tictactoe.color}`;
    }
  } catch (err) {
    tttStatus.textContent = "Could not reach backend.";
    console.error(err);
  } finally {
    tttBusy = false;
  }
}

async function finishTtt(outcome) {
  tttStatus.textContent = `Game Over: ${outcome}`;
  try {
    const res = await fetch("/api/game/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...sessionData,
        result: outcome,
        move_sequence: tttEngine.get_move_sequence(),
        ai_policy: aiPolicy.tictactoe,
        human_first: options.tictactoe.color === "X",
      }),
    });
    if (!res.ok) tttStatus.textContent = `Game Over: ${outcome} (verify failed)`;
  } catch (err) {
    console.error(err);
  }
}

function handleTttSetup(idx, side) {
  if (!tttEngine) return;
  pushHistory("tictactoe", snapshotTtt());
  paintTttCell(idx, side);
  renderTtt();
  syncSetupStatus("tictactoe");
}

async function handleTttPlay(idx) {
  if (tttBusy || tttGameOver) return;
  pushHistory("tictactoe", snapshotTtt());
  tttBusy = true;
  let code = tttEngine.play_human(idx);
  if (code === 255) {
    history.tictactoe.past.pop();
    syncUndoRedoButtons("tictactoe");
    tttBusy = false;
    return;
  }
  tttLastMove = idx;
  renderTtt();
  if (code !== 0) {
    tttGameOver = true;
    const outcome = code === 1 ? "WIN" : "DRAW";
    await finishTtt(outcome);
    tttBusy = false;
    return;
  }
  tttStatus.textContent = "AI thinking…";
  await delay(options.tictactoe.thinkMs);
  code = tttEngine.play_ai(tttPolicyCode(), currentDepth("tictactoe"));
  const seq = tttEngine.get_move_sequence();
  if (seq.length) tttLastMove = parseInt(seq[seq.length - 1], 10);
  renderTtt();
  if (code !== 0) {
    tttGameOver = true;
    const outcome = code === 2 ? "LOSS" : "DRAW";
    await finishTtt(outcome);
  } else {
    tttStatus.textContent = `Your move (${options.tictactoe.color})`;
  }
  tttBusy = false;
}

tttBoardEl.addEventListener("contextmenu", (ev) => ev.preventDefault());

tttCells.forEach((cell) => {
  cell.addEventListener("pointerdown", async (ev) => {
    if (currentGame !== "tictactoe") return;
    const idx = parseInt(cell.dataset.idx, 10);
    if (options.tictactoe.setupMode) {
      if (ev.button === 0) handleTttSetup(idx, "white");
      else if (ev.button === 2) {
        ev.preventDefault();
        handleTttSetup(idx, "black");
      }
      return;
    }
    if (ev.button !== 0) return;
    await handleTttPlay(idx);
  });
});

function undoTtt() {
  if (!history.tictactoe.past.length || tttBusy) return;
  const current = snapshotTtt();
  const prev = history.tictactoe.past.pop();
  history.tictactoe.future.push(current);
  restoreTtt(prev);
  if (options.tictactoe.setupMode) syncSetupStatus("tictactoe");
  else if (!tttGameOver) tttStatus.textContent = `Your move (${options.tictactoe.color})`;
  syncUndoRedoButtons("tictactoe");
}

function redoTtt() {
  if (!history.tictactoe.future.length || tttBusy) return;
  const current = snapshotTtt();
  const next = history.tictactoe.future.pop();
  history.tictactoe.past.push(current);
  restoreTtt(next);
  if (options.tictactoe.setupMode) syncSetupStatus("tictactoe");
  else if (tttGameOver) tttStatus.textContent = "Game Over";
  else tttStatus.textContent = `Your move (${options.tictactoe.color})`;
  syncUndoRedoButtons("tictactoe");
}

document.getElementById("ttt-undo").addEventListener("click", () => undoTtt());
document.getElementById("ttt-redo").addEventListener("click", () => redoTtt());

document.getElementById("ttt-new").addEventListener("click", () => {
  if (tttBusy) return;
  startTtt();
});

/* ——— Othello ——— */
const othello = new OthelloEngine();
let othelloBusy = false;
const othelloBoardEl = document.getElementById("othello-board");
const othelloStatus = document.getElementById("othello-status");
const scoreBlack = document.getElementById("score-black");
const scoreWhite = document.getElementById("score-white");

for (let i = 0; i < 64; i++) {
  const cell = document.createElement("div");
  cell.className = "o-cell";
  cell.dataset.idx = String(i);
  othelloBoardEl.appendChild(cell);
}
const oCells = othelloBoardEl.querySelectorAll(".o-cell");
othelloBoardEl.addEventListener("contextmenu", (ev) => ev.preventDefault());

function othelloHumanColor() {
  return options.othello.color === "white" ? WHITE : BLACK;
}

function snapshotOthello() {
  return {
    board: othello.board.slice(),
    turn: othello.turn,
    gameOver: othello.gameOver,
    humanColor: othello.humanColor,
    lastMove: othello.lastMove,
  };
}

function restoreOthello(snap) {
  othello.board = snap.board.slice();
  othello.turn = snap.turn;
  othello.gameOver = !!snap.gameOver;
  othello.humanColor = snap.humanColor;
  othello.lastMove = snap.lastMove ?? null;
  renderOthello();
}

function paintOthelloCell(i, side) {
  const chain = side === "white" ? [0, WHITE] : [0, BLACK];
  othello.board[i] = cycleValue(othello.board[i], chain);
  othello.lastMove = null;
  othello.gameOver = false;
}

function renderOthello() {
  applyBoardChrome("othello");
  const setup = options.othello.setupMode;
  const show = options.othello.showHints && !setup;
  const legal = new Set(
    !show || othello.gameOver || othello.turn !== othello.humanColor
      ? []
      : othello.legalForCurrent()
  );
  const { black, white } = countPieces(othello.board);
  scoreBlack.textContent = String(black);
  scoreWhite.textContent = String(white);

  oCells.forEach((cell, i) => {
    cell.classList.toggle("legal", legal.has(i));
    cell.classList.toggle("last-move", !setup && othello.lastMove === i);
    cell.innerHTML = "";
    const v = othello.board[i];
    if (v === BLACK || v === WHITE) {
      const disc = document.createElement("div");
      disc.className = `disc ${v === BLACK ? "black" : "white"}`;
      cell.appendChild(disc);
    }
    cell.style.cursor = setup || legal.has(i) ? "pointer" : "";
  });
  syncUndoRedoButtons("othello");
}

function finishOthello() {
  const outcome = outcomeForColor(othello.board, othello.humanColor);
  const { black, white } = countPieces(othello.board);
  const label =
    outcome === "WIN" ? "You win" : outcome === "LOSS" ? "AI wins" : "Draw";
  othelloStatus.textContent = `Game Over: ${label} (${black}–${white})`;
}

async function runOthelloAi() {
  othelloBusy = true;
  othelloStatus.textContent = "AI is thinking…";
  await delay(options.othello.thinkMs);
  const status = othello.playAi(aiPolicy.othello, currentDepth("othello"));
  renderOthello();
  if (status === "over") {
    finishOthello();
    othelloBusy = false;
    return;
  }
  if (status === "ai") {
    await runOthelloAi();
    return;
  }
  if (status === "pass") {
    othelloStatus.textContent = "AI passed — your move";
  } else {
    const label = othello.humanColor === BLACK ? "Black" : "White";
    othelloStatus.textContent = `Your move (${label})`;
  }
  othelloBusy = false;
  renderOthello();
}

async function startOthello() {
  const human = othelloHumanColor();
  othello.reset(human);
  othelloBusy = false;
  clearHistory("othello");
  const label = human === BLACK ? "Black" : "White";
  othelloStatus.textContent =
    human === BLACK ? `Your move (${label})` : "AI opens (Black)…";
  renderOthello();
  if (human === WHITE) await runOthelloAi();
}

function handleOthelloSetup(i, side) {
  pushHistory("othello", snapshotOthello());
  paintOthelloCell(i, side);
  renderOthello();
  syncSetupStatus("othello");
}

async function handleOthelloPlay(i) {
  if (othelloBusy || othello.gameOver) return;
  pushHistory("othello", snapshotOthello());
  const status = othello.playHuman(i);
  if (status === "invalid") {
    history.othello.past.pop();
    syncUndoRedoButtons("othello");
    return;
  }
  renderOthello();
  if (status === "over") {
    finishOthello();
    return;
  }
  if (status === "pass") {
    othelloStatus.textContent = "AI has no moves — your move again";
    return;
  }
  if (status === "ai") await runOthelloAi();
}

othelloBoardEl.addEventListener("pointerdown", async (ev) => {
  if (currentGame !== "othello") return;
  const cell = ev.target.closest(".o-cell");
  if (!cell) return;
  const i = parseInt(cell.dataset.idx, 10);

  if (options.othello.setupMode) {
    if (ev.button === 0) handleOthelloSetup(i, "white");
    else if (ev.button === 2) {
      ev.preventDefault();
      handleOthelloSetup(i, "black");
    }
    return;
  }
  if (ev.button !== 0) return;
  await handleOthelloPlay(i);
});

function undoOthello() {
  if (!history.othello.past.length || othelloBusy) return;
  const current = snapshotOthello();
  const prev = history.othello.past.pop();
  history.othello.future.push(current);
  restoreOthello(prev);
  if (options.othello.setupMode) syncSetupStatus("othello");
  else if (othello.gameOver) finishOthello();
  else {
    const label = othello.humanColor === BLACK ? "Black" : "White";
    othelloStatus.textContent = `Your move (${label})`;
  }
  syncUndoRedoButtons("othello");
}

function redoOthello() {
  if (!history.othello.future.length || othelloBusy) return;
  const current = snapshotOthello();
  const next = history.othello.future.pop();
  history.othello.past.push(current);
  restoreOthello(next);
  if (options.othello.setupMode) syncSetupStatus("othello");
  else if (othello.gameOver) finishOthello();
  else {
    const label = othello.humanColor === BLACK ? "Black" : "White";
    othelloStatus.textContent = `Your move (${label})`;
  }
  syncUndoRedoButtons("othello");
}

document.getElementById("othello-undo").addEventListener("click", () => undoOthello());
document.getElementById("othello-redo").addEventListener("click", () => redoOthello());

document.getElementById("othello-new").addEventListener("click", () => {
  if (othelloBusy) return;
  startOthello();
});

/* ——— Draughts variants ——— */
function mountDraughtsUi({
  gameId,
  variantKey,
  boardEl,
  statusEl,
  scoreBlackEl,
  scoreWhiteEl,
  scorelineEl,
  newBtn,
  undoBtn,
  redoBtn,
}) {
  const engine = new DraughtsEngine(variantKey);
  const size = engine.rules.size;
  let busy = false;
  let selectedFrom = null;

  boardEl.innerHTML = "";
  for (let i = 0; i < size * size; i++) {
    const r = (i / size) | 0;
    const c = i % size;
    const cell = document.createElement("div");
    cell.className = `d-cell ${(r + c) % 2 === 1 ? "dark" : "light"}`;
    cell.dataset.idx = String(i);
    boardEl.appendChild(cell);
  }
  const cells = boardEl.querySelectorAll(".d-cell");
  boardEl.addEventListener("contextmenu", (ev) => ev.preventDefault());

  function pieceClass(p) {
    if (p === BLACK_MAN || p === BLACK_KING) return "black";
    if (p === WHITE_MAN || p === WHITE_KING) return "white";
    return "";
  }

  function humanIsBlack() {
    return options[gameId].color !== "white";
  }

  function snapshot() {
    return {
      board: engine.board.slice(),
      blackTurn: engine.blackTurn,
      gameOver: engine.gameOver,
      winner: engine.winner,
      humanIsBlack: engine.humanIsBlack,
      lastMove: engine.lastMove ? { ...engine.lastMove } : null,
      selectedFrom,
    };
  }

  function restore(snap) {
    engine.board = snap.board.slice();
    engine.blackTurn = snap.blackTurn;
    engine.gameOver = !!snap.gameOver;
    engine.winner = snap.winner;
    engine.humanIsBlack = snap.humanIsBlack;
    engine.lastMove = snap.lastMove ? { ...snap.lastMove } : null;
    selectedFrom = snap.selectedFrom ?? null;
    render();
  }

  function paintCell(i, side) {
    const chain =
      side === "white" ? [0, WHITE_MAN, WHITE_KING] : [0, BLACK_MAN, BLACK_KING];
    engine.board[i] = cycleValue(engine.board[i], chain);
    engine.lastMove = null;
    engine.gameOver = false;
    engine.winner = null;
  }

  function render() {
    applyBoardChrome(gameId);
    const setup = options[gameId].setupMode;
    const show = options[gameId].showHints && !setup;
    const legal = engine.legal();
    const origins = new Set(
      show && engine.isHumanTurn() && !engine.gameOver ? legal.map((m) => m.from) : []
    );
    const targets =
      selectedFrom == null || !show
        ? new Set()
        : new Set(legal.filter((m) => m.from === selectedFrom).map((m) => m.to));
    const counts = countSide(engine.board);
    scoreBlackEl.textContent = String(counts.black);
    scoreWhiteEl.textContent = String(counts.white);
    if (scorelineEl && gameId === "draughts") {
      scorelineEl.style.display = options.draughts.showCounts ? "" : "none";
    }
    const lastFrom = setup ? undefined : engine.lastMove?.from;
    const lastTo = setup ? undefined : engine.lastMove?.to;

    cells.forEach((cell, i) => {
      const r = (i / size) | 0;
      const c = i % size;
      const dark = (r + c) % 2 === 1;
      cell.classList.toggle("selected", selectedFrom === i);
      cell.classList.toggle("legal", targets.has(i));
      cell.classList.toggle("last-from", lastFrom === i);
      cell.classList.toggle("last-to", lastTo === i);
      cell.classList.toggle(
        "origin",
        !setup && !busy && !engine.gameOver && engine.isHumanTurn() && origins.has(i)
      );
      cell.style.cursor = setup && dark ? "pointer" : "";
      cell.innerHTML = "";
      const p = engine.board[i];
      if (!p) return;
      const disc = document.createElement("div");
      disc.className = `d-piece ${pieceClass(p)}`;
      if (isKing(p)) disc.textContent = "K";
      cell.appendChild(disc);
    });
    syncUndoRedoButtons(gameId);
  }

  function finish() {
    const label = engine.winner === "WIN" ? "You win" : "AI wins";
    const c = countSide(engine.board);
    statusEl.textContent = `Game Over: ${label} (${c.black}–${c.white})`;
    selectedFrom = null;
    render();
  }

  async function runAi() {
    busy = true;
    statusEl.textContent = "AI is thinking…";
    selectedFrom = null;
    render();
    await delay(options[gameId].thinkMs);
    const status = engine.playAi(currentDepth(gameId), aiPolicy[gameId]);
    render();
    if (status === "over") {
      finish();
      busy = false;
      return;
    }
    statusEl.textContent = `Your move (${options[gameId].color === "white" ? "White" : "Black"})`;
    busy = false;
    render();
  }

  async function start() {
    if (options[gameId].setupMode) {
      render();
      syncSetupStatus(gameId);
      return;
    }
    engine.reset(humanIsBlack());
    busy = false;
    selectedFrom = null;
    clearHistory(gameId);
    const label = humanIsBlack() ? "Black" : "White";
    statusEl.textContent = humanIsBlack()
      ? `Your move (${label})`
      : "AI opens (Black)…";
    render();
    if (!humanIsBlack()) await runAi();
  }

  function clearSetup() {
    engine.board = engine.board.map(() => 0);
    engine.gameOver = false;
    engine.winner = null;
    engine.lastMove = null;
    selectedFrom = null;
    render();
  }

  async function applySetupExit() {
    engine.humanIsBlack = humanIsBlack();
    engine.blackTurn = options[gameId].sideToMove !== "white";
    engine.gameOver = false;
    engine.winner = null;
    engine.lastMove = null;
    busy = false;
    selectedFrom = null;
    clearHistory(gameId);
    render();
    if (!engine.isHumanTurn()) await runAi();
    else {
      statusEl.textContent = `Your move (${humanIsBlack() ? "Black" : "White"}) — custom position`;
    }
  }

  function undo() {
    if (!history[gameId].past.length || busy) return;
    const current = snapshot();
    const prev = history[gameId].past.pop();
    history[gameId].future.push(current);
    restore(prev);
    if (options[gameId].setupMode) syncSetupStatus(gameId);
    else if (engine.gameOver) finish();
    else statusEl.textContent = `Your move (${humanIsBlack() ? "Black" : "White"})`;
    syncUndoRedoButtons(gameId);
  }

  function redo() {
    if (!history[gameId].future.length || busy) return;
    const current = snapshot();
    const next = history[gameId].future.pop();
    history[gameId].past.push(current);
    restore(next);
    if (options[gameId].setupMode) syncSetupStatus(gameId);
    else if (engine.gameOver) finish();
    else statusEl.textContent = `Your move (${humanIsBlack() ? "Black" : "White"})`;
    syncUndoRedoButtons(gameId);
  }

  boardEl.addEventListener("pointerdown", async (ev) => {
    if (currentGame !== gameId) return;
    const cell = ev.target.closest(".d-cell");
    if (!cell) return;
    const i = parseInt(cell.dataset.idx, 10);
    const r = (i / size) | 0;
    const c = i % size;

    if (options[gameId].setupMode) {
      if ((r + c) % 2 !== 1) return;
      if (ev.button === 0) {
        pushHistory(gameId, snapshot());
        paintCell(i, "white");
        selectedFrom = null;
        render();
        syncSetupStatus(gameId);
      } else if (ev.button === 2) {
        ev.preventDefault();
        pushHistory(gameId, snapshot());
        paintCell(i, "black");
        selectedFrom = null;
        render();
        syncSetupStatus(gameId);
      }
      return;
    }

    if (ev.button !== 0) return;
    if (busy || engine.gameOver || !engine.isHumanTurn()) return;
    const legal = engine.legal();
    const fromHere = legal.filter((m) => m.from === i);
    const mustSelect = options[gameId].mustSelect !== false;

    if (mustSelect) {
      if (
        selectedFrom == null ||
        (fromHere.length &&
          selectedFrom !== i &&
          isBlack(engine.board[i]) === humanIsBlack())
      ) {
        if (!fromHere.length) return;
        const p = engine.board[i];
        if (humanIsBlack() ? !isBlack(p) : isBlack(p)) return;
        selectedFrom = i;
        statusEl.textContent = "Select a destination square";
        render();
        return;
      }
    } else if (fromHere.length && selectedFrom !== i) {
      selectedFrom = i;
      render();
      return;
    }

    const optionsMoves = legal.filter((m) => m.from === selectedFrom && m.to === i);
    if (!optionsMoves.length) {
      if (fromHere.length) {
        selectedFrom = i;
        render();
      }
      return;
    }

    optionsMoves.sort((a, b) => b.captures.length - a.captures.length);
    pushHistory(gameId, snapshot());
    const status = engine.play(optionsMoves[0]);
    selectedFrom = null;
    render();
    if (status === "invalid") {
      history[gameId].past.pop();
      syncUndoRedoButtons(gameId);
      return;
    }
    if (status === "over") {
      finish();
      return;
    }
    if (status === "ai") await runAi();
  });

  newBtn.addEventListener("click", () => {
    if (busy) return;
    start();
  });
  undoBtn?.addEventListener("click", () => undo());
  redoBtn?.addEventListener("click", () => redo());

  return { start, render, clearSetup, applySetupExit, snapshot, restore, undo, redo };
}

const checkersUi = mountDraughtsUi({
  gameId: "checkers",
  variantKey: "american",
  boardEl: document.getElementById("checkers-board"),
  statusEl: document.getElementById("checkers-status"),
  scoreBlackEl: document.getElementById("checkers-black"),
  scoreWhiteEl: document.getElementById("checkers-white"),
  scorelineEl: null,
  newBtn: document.getElementById("checkers-new"),
  undoBtn: document.getElementById("checkers-undo"),
  redoBtn: document.getElementById("checkers-redo"),
});

const draughtsUi = mountDraughtsUi({
  gameId: "draughts",
  variantKey: "international",
  boardEl: document.getElementById("draughts-board"),
  statusEl: document.getElementById("draughts-status"),
  scoreBlackEl: document.getElementById("draughts-black"),
  scoreWhiteEl: document.getElementById("draughts-white"),
  scorelineEl: document.getElementById("draughts-scoreline"),
  newBtn: document.getElementById("draughts-new"),
  undoBtn: document.getElementById("draughts-undo"),
  redoBtn: document.getElementById("draughts-redo"),
});

readOptionsFromDom();
syncSideToggles();
renderAlgorithms("tictactoe");
["tictactoe", "othello", "checkers", "draughts"].forEach((g) => {
  applyBoardChrome(g);
  syncDepthControls(g);
  syncUndoRedoButtons(g);
});

async function setup() {
  await init();
  tttEngine = new TicTacToeEngine();
  await startTtt();
}

setup().catch((err) => {
  tttStatus.textContent = "Failed to load Wasm engine.";
  console.error("Wasm init failed:", err);
});
