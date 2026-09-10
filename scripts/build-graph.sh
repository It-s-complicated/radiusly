#!/bin/sh
# Builds the routing graph into /graph unless the volume already holds the requested OSM_DATE.
set -e
if [ -f /graph/graph.json ] && [ "$(cat /graph/graph.date 2>/dev/null || true)" = "$OSM_DATE" ]; then
	echo "routing graph for $OSM_DATE already built, skipping"
	exit 0
fi
python -c "from urllib.request import urlretrieve; urlretrieve('https://download.geofabrik.de/europe/germany/brandenburg-$OSM_DATE.osm.pbf', '/tmp/source.osm.pbf')"
python build-walking-graph.py /tmp/source.osm.pbf /graph/graph.json \
	--region berlin --bounds 13.08 52.33 13.77 52.68
rm /tmp/source.osm.pbf
echo "$OSM_DATE" > /graph/graph.date
echo "routing graph for $OSM_DATE built"
