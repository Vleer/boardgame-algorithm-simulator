from __future__ import annotations

import hashlib
import hmac
import os
import time

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

SECRET_KEY = os.environ.get(
    "GAME_SECRET_KEY", "super-secret-game-signing-key-32bytes"
).encode("utf-8")

WIN_PATTERNS = [
    0b000_000_111,
    0b000_111_000,
    0b111_000_000,
    0b001_001_001,
    0b010_010_010,
    0b100_100_100,
    0b100_010_001,
    0b001_010_100,
]

app = FastAPI(title="Boardgame Algorithm Simulator")


class GameStartResponse(BaseModel):
    session_id: str
    timestamp: int
    signature: str


class GameFinishPayload(BaseModel):
    session_id: str
    timestamp: int
    signature: str
    move_sequence: str = Field(..., description='e.g. "04138"')
    result: str = Field(..., description='"WIN", "LOSS", or "DRAW"')
    ai_policy: str = Field(default="strong", description="strong|random|semirandom")
    human_first: bool = Field(default=True)


def generate_signature(session_id: str, timestamp: int) -> str:
    msg = f"{session_id}:{timestamp}".encode("utf-8")
    return hmac.new(SECRET_KEY, msg, hashlib.sha256).hexdigest()


def is_win(mask: int) -> bool:
    return any((mask & pat) == pat for pat in WIN_PATTERNS)


def minimax(p_bits: int, a_bits: int, is_ai: bool, depth: int) -> int:
    if is_win(a_bits):
        return 10 - depth
    if is_win(p_bits):
        return depth - 10
    if (p_bits | a_bits) == 0b1_1111_1111:
        return 0

    if is_ai:
        best = -(10**9)
        for i in range(9):
            bit = 1 << i
            if (p_bits | a_bits) & bit == 0:
                best = max(best, minimax(p_bits, a_bits | bit, False, depth + 1))
        return best

    best = 10**9
    for i in range(9):
        bit = 1 << i
        if (p_bits | a_bits) & bit == 0:
            best = min(best, minimax(p_bits | bit, a_bits, True, depth + 1))
    return best


def find_best_ai_move(player_bits: int, ai_bits: int) -> int:
    best_score = -(10**9)
    best_move = 0
    for i in range(9):
        bit = 1 << i
        if (player_bits | ai_bits) & bit == 0:
            score = minimax(player_bits, ai_bits | bit, False, 0)
            if score > best_score:
                best_score = score
                best_move = i
    return best_move


def verify_recorded_sequence(moves: str, claimed_result: str, human_first: bool) -> bool:
    """Replay recorded plies without assuming perfect AI replies."""
    if claimed_result not in {"WIN", "LOSS", "DRAW"}:
        return False
    if not moves or len(moves) > 9 or not moves.isdigit():
        return False
    if any(c < "0" or c > "8" for c in moves):
        return False
    if len(set(moves)) != len(moves):
        return False

    player_bits = 0
    ai_bits = 0
    result: str | None = None
    played = 0

    for n, ch in enumerate(moves):
        cell = int(ch)
        bit = 1 << cell
        if (player_bits | ai_bits) & bit:
            return False
        human_turn = (n % 2 == 0) if human_first else (n % 2 == 1)
        if human_turn:
            player_bits |= bit
            if is_win(player_bits):
                result = "WIN"
                played = n + 1
                break
        else:
            ai_bits |= bit
            if is_win(ai_bits):
                result = "LOSS"
                played = n + 1
                break
        if (player_bits | ai_bits) == 0b1_1111_1111:
            result = "DRAW"
            played = n + 1
            break
    else:
        return False

    if result is None or played != len(moves):
        return False
    return result == claimed_result


def verify_move_sequence(moves: str, claimed_result: str) -> bool:
    """Replay with perfect minimax AI (human first)."""
    if claimed_result not in {"WIN", "LOSS", "DRAW"}:
        return False
    if not moves or len(moves) > 9 or not moves.isdigit():
        return False
    if any(c < "0" or c > "8" for c in moves):
        return False
    if len(set(moves)) != len(moves):
        return False

    player_bits = 0
    ai_bits = 0
    result: str | None = None
    i = 0

    while i < len(moves):
        cell = int(moves[i])
        bit = 1 << cell
        if (player_bits | ai_bits) & bit:
            return False
        player_bits |= bit
        i += 1

        if is_win(player_bits):
            result = "WIN"
            break
        if (player_bits | ai_bits) == 0b1_1111_1111:
            result = "DRAW"
            break

        expected_ai = find_best_ai_move(player_bits, ai_bits)
        if i >= len(moves):
            return False
        if int(moves[i]) != expected_ai:
            return False

        ai_bits |= 1 << expected_ai
        i += 1

        if is_win(ai_bits):
            result = "LOSS"
            break
        if (player_bits | ai_bits) == 0b1_1111_1111:
            result = "DRAW"
            break

    if result is None:
        return False
    if i != len(moves):
        return False
    return result == claimed_result


@app.post("/api/game/start", response_model=GameStartResponse)
def start_game():
    session_id = f"sess_{int(time.time_ns())}"
    now = int(time.time())
    sig = generate_signature(session_id, now)
    return {
        "session_id": session_id,
        "timestamp": now,
        "signature": sig,
    }


@app.post("/api/game/finish")
def finish_game(payload: GameFinishPayload):
    expected_sig = generate_signature(payload.session_id, payload.timestamp)
    if not hmac.compare_digest(expected_sig, payload.signature):
        raise HTTPException(status_code=403, detail="Invalid session signature")

    if time.time() - payload.timestamp > 600:
        raise HTTPException(status_code=400, detail="Session expired")

    strict = payload.ai_policy == "strong" and payload.human_first
    ok = (
        verify_move_sequence(payload.move_sequence, payload.result)
        if strict
        else verify_recorded_sequence(
            payload.move_sequence, payload.result, payload.human_first
        )
    )
    if not ok:
        raise HTTPException(status_code=422, detail="Manipulated match data")

    return {"status": "SUCCESS", "message": "Match verified and recorded"}


@app.get("/health")
def health():
    return {"status": "ok"}


STATIC_ROOT = os.environ.get("STATIC_ROOT", "/app/static")


@app.get("/")
def index():
    index_path = os.path.join(STATIC_ROOT, "index.html")
    if not os.path.isfile(index_path):
        raise HTTPException(status_code=404, detail="Frontend not found")
    return FileResponse(index_path)


@app.get("/{name}.js")
def serve_js_module(name: str):
    if "/" in name or "\\" in name or name.startswith("."):
        raise HTTPException(status_code=404, detail="Not found")
    path = os.path.join(STATIC_ROOT, f"{name}.js")
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Module not found")
    return FileResponse(path, media_type="text/javascript")


pkg_dir = os.path.join(STATIC_ROOT, "pkg")
if os.path.isdir(pkg_dir):
    app.mount("/pkg", StaticFiles(directory=pkg_dir), name="pkg")
