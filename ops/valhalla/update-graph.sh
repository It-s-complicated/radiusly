#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

if [ ! -f .env ]; then
	echo "Copy .env.example to .env and configure it first" >&2
	exit 2
fi
# shellcheck disable=SC1091
. ./.env

VERSION=${1:-}
case "$VERSION" in
	''|*[!A-Za-z0-9._-]*)
		echo "Usage: $0 <graph-version>" >&2
		exit 2
		;;
esac

: "${PBF_URL:?Set PBF_URL in ops/valhalla/.env}"
: "${VALHALLA_IMAGE:=ghcr.io/gis-ops/docker-valhalla/valhalla@sha256:060da5b92e6024a67f65135c236d918b021d63e73d1808a0d55b7e7cbd17240c}"

mkdir -p data/releases
exec 9>data/update.lock
flock -n 9 || { echo "Another graph update is running" >&2; exit 1; }

RELEASE_DIR="$SCRIPT_DIR/data/releases/$VERSION"
if [ -e "$RELEASE_DIR/valhalla_tiles.tar" ]; then
	echo "Graph release $VERSION already exists" >&2
	exit 1
fi
mkdir -p "$RELEASE_DIR"

echo "Building graph release $VERSION from $PBF_URL"
docker run --rm \
	--name "radiusly-valhalla-build-$VERSION" \
	-v "$RELEASE_DIR:/custom_files" \
	-e "tile_urls=$PBF_URL" \
	-e use_tiles_ignore_pbf=False \
	-e force_rebuild=True \
	-e build_admins=True \
	-e build_time_zones=True \
	-e build_tar=True \
	-e serve_tiles=False \
	"$VALHALLA_IMAGE"

test -s "$RELEASE_DIR/valhalla_tiles.tar" || {
	echo "Graph build did not produce valhalla_tiles.tar" >&2
	exit 1
}

PREVIOUS=$(readlink data/current 2>/dev/null || true)
ln -sfn "releases/$VERSION" data/current.next
mv -Tf data/current.next data/current

docker compose up -d --force-recreate valhalla
if timeout 120 sh -c 'until docker compose exec -T valhalla curl --fail --silent http://127.0.0.1:8002/status >/dev/null; do sleep 3; done'; then
	printf '%s\n' "$VERSION" > data/GRAPH_VERSION
	docker compose up -d gateway
	echo "Activated graph $VERSION. Set VALHALLA_GRAPH_VERSION=$VERSION in Netlify."
	exit 0
fi

echo "New graph failed health checks; rolling back" >&2
if [ -n "$PREVIOUS" ]; then
	ln -sfn "$PREVIOUS" data/current.next
	mv -Tf data/current.next data/current
	docker compose up -d --force-recreate valhalla
else
	rm -f data/current
	docker compose stop valhalla
fi
exit 1
