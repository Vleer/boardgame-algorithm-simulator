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
}

#[wasm_bindgen]
impl TicTacToeEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            player_bits: 0,
            ai_bits: 0,
            move_history: Vec::with_capacity(9),
        }
    }

    /// Reset engine for new match
    pub fn reset(&mut self) {
        self.player_bits = 0;
        self.ai_bits = 0;
        self.move_history.clear();
    }

    /// Check if target bitmask matches win pattern
    fn is_win(mask: u16) -> bool {
        WIN_PATTERNS.iter().any(|&pat| (mask & pat) == pat)
    }

    /// Submit a player move (0-8). Returns encoded status code:
    /// 0 = Game Continues, 1 = Player Won, 2 = AI Won, 3 = Draw, 255 = Invalid Move
    pub fn play_turn(&mut self, cell_index: u8) -> u32 {
        if cell_index > 8 {
            return 255;
        }
        let bit = 1u16 << cell_index;

        // Ensure cell is unoccupied
        if (self.player_bits | self.ai_bits) & bit != 0 {
            return 255;
        }

        // Apply Player Move
        self.player_bits |= bit;
        self.move_history.push(cell_index);

        if Self::is_win(self.player_bits) {
            return 1; // Player Wins
        }
        if (self.player_bits | self.ai_bits) == 0b1_1111_1111 {
            return 3; // Draw
        }

        // AI Move via Minimax
        let ai_move = self.find_best_ai_move();
        self.ai_bits |= 1u16 << ai_move;
        self.move_history.push(ai_move);

        if Self::is_win(self.ai_bits) {
            return 2; // AI Wins
        }
        if (self.player_bits | self.ai_bits) == 0b1_1111_1111 {
            return 3; // Draw
        }

        0 // Game continues
    }

    /// Minimax implementation for unbeatable AI
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

    /// Get current state bitmasks for UI rendering
    pub fn get_player_bits(&self) -> u16 {
        self.player_bits
    }

    pub fn get_ai_bits(&self) -> u16 {
        self.ai_bits
    }

    /// Move sequence as digit string, e.g. "04138"
    pub fn get_move_sequence(&self) -> String {
        self.move_history
            .iter()
            .map(|m| (b'0' + m) as char)
            .collect()
    }
}
