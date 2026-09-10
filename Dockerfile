FROM python:3.13-slim AS graph

ARG OSM_DATE=260909

WORKDIR /src
RUN apt-get update \
	&& apt-get install --yes --no-install-recommends libexpat1 \
	&& rm -rf /var/lib/apt/lists/*

COPY scripts/requirements-routing.txt .
RUN pip install --no-cache-dir -r requirements-routing.txt

COPY scripts/build-walking-graph.py .
RUN python -c "from urllib.request import urlretrieve; urlretrieve('https://download.geofabrik.de/europe/germany/brandenburg-${OSM_DATE}.osm.pbf', '/tmp/source.osm.pbf')" \
	&& python build-walking-graph.py /tmp/source.osm.pbf /graph/graph.json \
		--region berlin --bounds 13.08 52.33 13.77 52.68 \
	&& rm /tmp/source.osm.pbf

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
COPY --from=graph --chown=node:node /graph/graph.json ./data/routing/graph.json

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD ["node", "-e", "fetch('http://127.0.0.1:3000/login').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "build"]
