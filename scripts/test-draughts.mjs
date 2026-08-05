import {
  DraughtsEngine,
  legalMoves,
  createInitialBoard,
  VARIANTS,
  countSide,
} from "../frontend/draughts.js";

const am = VARIANTS.american;
const board = createInitialBoard(am);
const counts = countSide(board);
console.assert(counts.black === 12 && counts.white === 12, "american setup", counts);

const eng = new DraughtsEngine("american");
const moves = eng.legal();
console.assert(moves.length > 0, "american has opening moves", moves.length);
console.assert(moves.every((m) => m.captures.length === 0), "opening has no captures");

const intl = new DraughtsEngine("international");
const ic = countSide(intl.board);
console.assert(ic.black === 20 && ic.white === 20, "intl setup", ic);
console.assert(intl.legal().length > 0, "intl opening moves");

// Force a simple american capture setup on empty-ish board
const b = createInitialBoard(am).map(() => 0);
// Black man at r5c2 (idx 42), white man at r4c3 (idx 35), land r3c4 (idx 28)
// size 8: idx = r*8+c; dark (5+2)%2=1, (4+3)%2=1, (3+4)%2=1
b[5 * 8 + 2] = 1; // BLACK_MAN
b[4 * 8 + 3] = 3; // WHITE_MAN
const caps = legalMoves(b, am, true);
console.assert(caps.some((m) => m.captures.length === 1 && m.to === 3 * 8 + 4), "forward capture", caps);

console.log("draughts smoke OK", { amMoves: moves.length, intlMoves: intl.legal().length, caps: caps.length });
