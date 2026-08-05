# Stage 1: compile Rust → WebAssembly (no Rust needed on the host)
FROM rust:bookworm AS wasm-builder

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh \
    && rustup target add wasm32-unknown-unknown

WORKDIR /build
COPY wasm/ ./

# --no-opt: binaryen's wasm-opt breaks wasm-bindgen's externref table
# (RangeError: WebAssembly.Table.grow(): failed to grow table by 4)
RUN wasm-pack build --target web --release --no-opt

# Stage 2: Python FastAPI serving API + static frontend + Wasm pkg
FROM python:3.12-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    STATIC_ROOT=/app/static

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/main.py .
COPY frontend/ ${STATIC_ROOT}/
COPY --from=wasm-builder /build/pkg ${STATIC_ROOT}/pkg

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
