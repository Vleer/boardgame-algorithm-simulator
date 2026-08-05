# Boardgame Algorithm Simulator

Interactive board games with visible algorithms — Rust WebAssembly for Tic-Tac-Toe, client-side AI for Othello — plus a Python FastAPI backend. Fully built and run in Docker — **no Rust (or Python) install required on the host**.

## Games

- **Tic-Tac-Toe** — Wasm bitboard engine, unbeatable minimax, HMAC session + server replay verify
- **Othello** — 8×8 Reversi with positional alpha-beta AI
- **Checkers** — American / English Draughts (8×8, step kings, forward-only men)
- **International Draughts** — 10×10, flying kings, majority capture, end-of-turn promotion

## Run

```bash
docker compose up --build
```

Open [http://localhost:8080](http://localhost:8080).

## Architecture

| Layer | Role |
| --- | --- |
| `wasm/` | Rust bitboard Tic-Tac-Toe engine + minimax → `wasm32` via `wasm-pack` |
| `frontend/` | Arcade UI (games + algorithm sidebars); Wasm TTT + JS Othello |
| `backend/` | FastAPI: HMAC session minting + deterministic TTT replay verify |

Rust compilation happens only inside the Docker image (`rust` stage). The runtime image is Python slim and serves the API plus static assets.

## Useful commands

```bash
# Build & start in background
docker compose up --build -d

# Logs
docker compose logs -f

# Stop
docker compose down
```

Optional: override the session signing key:

```bash
GAME_SECRET_KEY=your-own-secret docker compose up --build
```
