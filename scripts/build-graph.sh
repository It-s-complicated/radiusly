#!/bin/sh
# Builds the routing graph into /graph unless the volume holds this date and builder.
set -e
builder_hash=$(sha256sum /usr/local/bin/routing-graph)
if [ -f /graph/graph.json ] && [ "$(cat /graph/graph.date 2>/dev/null || true)" = "$OSM_DATE" ] \
	&& [ "$(cat /graph/graph.builder 2>/dev/null || true)" = "$builder_hash" ]; then
	echo "routing graph for $OSM_DATE already built, skipping"
	exit 0
fi
curl -fL "https://download.geofabrik.de/europe/germany/brandenburg-$OSM_DATE.osm.pbf" \
	-o /tmp/source.osm.pbf
routing-graph /tmp/source.osm.pbf /graph/graph.json \
	--region berlin --bounds 13.08 52.33 13.77 52.68
rm /tmp/source.osm.pbf
printf '%s\n' "$builder_hash" > /graph/graph.builder
printf '%s\n' "$OSM_DATE" > /graph/graph.date
echo "routing graph for $OSM_DATE built"
