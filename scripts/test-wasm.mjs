import init, { TicTacToeEngine } from "./tictactoe_wasm.js";
import { readFileSync } from "fs";

try {
  const bytes = readFileSync("./tictactoe_wasm_bg.wasm");
  await init({ module_or_path: bytes });
  const eng = new TicTacToeEngine();
  console.log(
    "OK",
    eng.get_player_bits(),
    eng.play_turn(4),
    eng.get_move_sequence()
  );
} catch (e) {
  console.error("FAIL", e);
  process.exit(1);
}
