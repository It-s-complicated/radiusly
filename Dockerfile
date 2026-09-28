FROM rust:1.98-slim-bookworm AS graph-builder

WORKDIR /src
COPY routing-graph-rs/Cargo.toml routing-graph-rs/Cargo.lock ./
RUN mkdir src && printf 'fn main() {}\n' > src/main.rs && cargo build --locked --release
COPY routing-graph-rs/src ./src
RUN touch src/main.rs && cargo build --locked --release

FROM debian:bookworm-slim AS graph

ARG OSM_DATE=260901
ENV OSM_DATE=$OSM_DATE

WORKDIR /src
RUN apt-get update \
	&& apt-get install --yes --no-install-recommends ca-certificates curl \
	&& rm -rf /var/lib/apt/lists/*

COPY --from=graph-builder /src/target/release/routing-graph /usr/local/bin/routing-graph
COPY scripts/build-graph.sh ./
ENTRYPOINT ["./build-graph.sh"]

FROM node:24-bookworm-slim AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
	HOST=0.0.0.0 \
	PORT=3000 \
	ROUTING_GRAPH_PATH=/app/data/routing/graph.json

COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/.routing ./.routing
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
# routing graph comes from the shared `graph` volume (see compose.yml), not from the image

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD ["node", "-e", "fetch('http://127.0.0.1:3000/login').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "build"]
