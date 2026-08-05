use wasm_bindgen::prelude::*;

// Winning patterns: 3 rows, 3 columns, 2 diagonals
const WIN_PATTERNS: [u16; 8] = [
    0b000_000_111, // Row 1
    0b000_111_000, // Row 2
    0b111_000_000, // Row 3
    0b001_001_001, // Col 1
    0b010_010_010, // Col 2
    0b100_100_100, // Col 3
    0b100_010_001, // Diag 1
    0b001_010_100, // Diag 2
];

#[wasm_bindgen]
pub struct TicTacToeEngine {
    player_bits: u16,
    ai_bits: u16,
    move_history: Vec<u8>,
    rng: u32,
}

#[wasm_bindgen]
impl TicTacToeEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            player_bits: 0,
            ai_bits: 0,
            move_history: Vec::with_capacity(9),
            rng: 0xA5_A5_F00Du32,
        }
    }

    pub fn reset(&mut self) {
        self.player_bits = 0;
        self.ai_bits = 0;
        self.move_history.clear();
        self.rng = self.rng.wrapping_mul(1664525).wrapping_add(1013904223);
    }

    fn is_win(mask: u16) -> bool {
        WIN_PATTERNS.iter().any(|&pat| (mask & pat) == pat)
    }

    fn next_rng(&mut self) -> u32 {
        // xorshift
        let mut x = self.rng
            ^ (self.player_bits as u32)
            ^ ((self.ai_bits as u32) << 8)
            ^ (self.move_history.len() as u32);
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.rng = x;
        x
    }

    fn empty_cells(&self) -> Vec<u8> {
        let mut out = Vec::new();
        for i in 0..9u8 {
            let bit = 1u16 << i;
            if (self.player_bits | self.ai_bits) & bit == 0 {
                out.push(i);
            }
        }
        out
    }

    fn status_after_ai(&self) -> u32 {
        if Self::is_win(self.ai_bits) {
            return 2;
        }
        if (self.player_bits | self.ai_bits) == 0b1_1111_1111 {
            return 3;
        }
        0
    }

    fn status_after_player(&self) -> u32 {
        if Self::is_win(self.player_bits) {
            return 1;
        }
        if (self.player_bits | self.ai_bits) == 0b1_1111_1111 {
            return 3;
        }
        0
    }

    /// Human-only move (0-8). Does not invoke the AI.
    pub fn play_human(&mut self, cell_index: u8) -> u32 {
        if cell_index > 8 {
            return 255;
        }
        let bit = 1u16 << cell_index;
        if (self.player_bits | self.ai_bits) & bit != 0 {
            return 255;
        }
        self.player_bits |= bit;
        self.move_history.push(cell_index);
        self.status_after_player()
    }

    /// AI-only move. policy: 0 = minimax, 1 = random, 2 = semi-random, 3 = mcts
    /// `depth` is ply for search algos / budget tier for MCTS (1+).
    pub fn play_ai(&mut self, policy: u32, depth: u32) -> u32 {
        let empties = self.empty_cells();
        if empties.is_empty() {
            return 3;
        }
        let depth = depth.max(1);

        let ai_move = match policy {
            1 => {
                let i = (self.next_rng() as usize) % empties.len();
                empties[i]
            }
            2 => self.find_semirandom_ai_move(&empties),
            3 => self.find_mcts_ai_move(&empties, depth),
            _ => self.find_best_ai_move(),
        };

        self.ai_bits |= 1u16 << ai_move;
        self.move_history.push(ai_move);
        self.status_after_ai()
    }

    /// Legacy: human move then minimax AI reply.
    pub fn play_turn(&mut self, cell_index: u8) -> u32 {
        let human = self.play_human(cell_index);
        if human != 0 {
            return human;
        }
        self.play_ai(0, 3)
    }

    fn find_best_ai_move(&self) -> u8 {
        let mut best_score = i32::MIN;
        let mut best_move = 0;

        for i in 0..9 {
            let bit = 1u16 << i;
            if (self.player_bits | self.ai_bits) & bit == 0 {
                let score = self.minimax(self.player_bits, self.ai_bits | bit, false, 0);
                if score > best_score {
                    best_score = score;
                    best_move = i;
                }
            }
        }
        best_move
    }

    fn find_semirandom_ai_move(&mut self, empties: &[u8]) -> u8 {
        let mut scored: Vec<(u8, i32)> = empties
            .iter()
            .map(|&i| {
                let bit = 1u16 << i;
                let score = self.minimax(self.player_bits, self.ai_bits | bit, false, 0);
                (i, score)
            })
            .collect();
        scored.sort_by(|a, b| b.1.cmp(&a.1));
        let keep = (scored.len() + 1) / 2;
        let i = (self.next_rng() as usize) % keep.max(1);
        scored[i].0
    }

    /// Flat MCTS / multi-armed bandit: simulate random games from each opening move.
    fn find_mcts_ai_move(&mut self, empties: &[u8], depth: u32) -> u8 {
        let iterations = 40u32 + depth.saturating_mul(28);
        let mut wins = vec![0u32; empties.len()];
        let mut plays = vec![0u32; empties.len()];

        for _ in 0..iterations {
            let idx = (self.next_rng() as usize) % empties.len();
            let first = empties[idx];
            let mut p = self.player_bits;
            let mut a = self.ai_bits | (1u16 << first);
            let mut ai_turn = false; // human replies next
            plays[idx] += 1;

            let outcome = loop {
                if Self::is_win(a) {
                    break 1i32; // AI win
                }
                if Self::is_win(p) {
                    break 0;
                }
                if (p | a) == 0b1_1111_1111 {
                    break 0; // draw counts as non-win for bandit
                }
                let mut choices = Vec::new();
                for i in 0..9u8 {
                    let bit = 1u16 << i;
                    if (p | a) & bit == 0 {
                        choices.push(i);
                    }
                }
                if choices.is_empty() {
                    break 0;
                }
                let pick = choices[(self.next_rng() as usize) % choices.len()];
                if ai_turn {
                    a |= 1u16 << pick;
                } else {
                    p |= 1u16 << pick;
                }
                ai_turn = !ai_turn;
            };
            if outcome > 0 {
                wins[idx] += 1;
            }
        }

        let mut best_i = 0usize;
        let mut best_score = -1.0f64;
        for i in 0..empties.len() {
            let score = if plays[i] == 0 {
                0.0
            } else {
                wins[i] as f64 / plays[i] as f64
            };
            if score > best_score {
                best_score = score;
                best_i = i;
            }
        }
        empties[best_i]
    }

    fn minimax(&self, p_bits: u16, a_bits: u16, is_ai: bool, depth: i32) -> i32 {
        if Self::is_win(a_bits) {
            return 10 - depth;
        }
        if Self::is_win(p_bits) {
            return depth - 10;
        }
        if (p_bits | a_bits) == 0b1_1111_1111 {
            return 0;
        }

        if is_ai {
            let mut best = i32::MIN;
            for i in 0..9 {
                let bit = 1u16 << i;
                if (p_bits | a_bits) & bit == 0 {
                    best = best.max(self.minimax(p_bits, a_bits | bit, false, depth + 1));
                }
            }
            best
        } else {
            let mut best = i32::MAX;
            for i in 0..9 {
                let bit = 1u16 << i;
                if (p_bits | a_bits) & bit == 0 {
                    best = best.min(self.minimax(p_bits | bit, a_bits, true, depth + 1));
                }
            }
            best
        }
    }

    pub fn get_player_bits(&self) -> u16 {
        self.player_bits
    }

    pub fn get_ai_bits(&self) -> u16 {
        self.ai_bits
    }

    pub fn get_move_sequence(&self) -> String {
        self.move_history
            .iter()
            .map(|m| (b'0' + m) as char)
            .collect()
    }

    /// Setup editor: 0 = empty, 1 = human/player, 2 = AI. Clears move history.
    pub fn set_cell(&mut self, cell_index: u8, owner: u32) {
        if cell_index > 8 {
            return;
        }
        let bit = 1u16 << cell_index;
        self.player_bits &= !bit;
        self.ai_bits &= !bit;
        if owner == 1 {
            self.player_bits |= bit;
        } else if owner == 2 {
            self.ai_bits |= bit;
        }
        self.move_history.clear();
    }

    pub fn clear_board(&mut self) {
        self.player_bits = 0;
        self.ai_bits = 0;
        self.move_history.clear();
    }

    /// Restore a full position (for undo/redo).
    pub fn load_state(&mut self, player_bits: u16, ai_bits: u16, history: &str) {
        self.player_bits = player_bits & 0b1_1111_1111;
        self.ai_bits = ai_bits & 0b1_1111_1111;
        self.move_history.clear();
        for ch in history.chars() {
            if let Some(d) = ch.to_digit(10) {
                if d <= 8 {
                    self.move_history.push(d as u8);
                }
            }
        }
    }
}
