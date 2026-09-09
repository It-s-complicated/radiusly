#!/usr/bin/env python3
"""Compile OSM PBF/XML into a local pedestrian graph. Requires osmium==4.3.1."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import osmium

ALLOWED = {'yes', 'designated', 'permissive', 'official'}
HIGHWAYS = {'footway', 'path', 'pedestrian', 'steps', 'living_street', 'residential',
            'service', 'unclassified', 'tertiary', 'tertiary_link', 'secondary',
            'secondary_link', 'primary', 'primary_link', 'track'}


def access(tags):
    if tags.get('foot:conditional') or tags.get('access:conditional') or tags.get('opening_hours'):
        return False
    permission = tags.get('foot', tags.get('access', 'yes'))
    return permission in ALLOWED


def flags(tags):
    highway = tags.get('highway')
    if highway not in HIGHWAYS or not access(tags) or tags.get('area') == 'yes':
        return 0
    if tags.get('construction') or tags.get('indoor') == 'yes' or tags.get('conveying') not in (None, 'no'):
        return 0
    # Separate sidewalk mapping must not be replaced with imaginary road crossings.
    if tags.get('foot') == 'use_sidepath':
        return 0
    if highway in {'primary', 'primary_link', 'secondary', 'secondary_link'} and tags.get('foot') not in ALLOWED:
        return 0
    direction = tags.get('oneway:foot')
    if tags.get('oneway:foot:conditional') or tags.get('foot:forward:conditional') or tags.get('foot:backward:conditional'):
        return 0
    # ponytail: ambiguous pedestrian oneway is excluded; add country/tag-specific interpretation with fixtures.
    if direction is None and highway in {'footway','path','pedestrian','steps'} and tags.get('oneway') in {'yes','1','-1'}:
        return 0
    if direction not in (None, 'yes', '1', '-1', 'no', '0', 'false'):
        return 0
    result = {'yes': 1, '1': 1, '-1': 2}.get(direction, 3)
    if tags.get('foot:forward', 'yes') not in ALLOWED:
        result &= ~1
    if tags.get('foot:backward', 'yes') not in ALLOWED:
        result &= ~2
    return result


class Importer(osmium.SimpleHandler):
    def __init__(self, bounds):
        super().__init__()
        self.bounds = bounds
        self.blocked = set()
        self.excluded_ways = set()
        self.ways = []
        self.stations = []
        self.incomplete = 0

    def inside(self, lat, lon):
        west, south, east, north = self.bounds
        # 25 km data buffer around supported starts; maximum accepted walk is 37.5 km.
        dy = 25000 / 110000
        dx = dy / math.cos(math.radians(max(abs(south), abs(north))))
        return west-dx <= lon <= east+dx and south-dy <= lat <= north+dy

    def node(self, node):
        tags = dict(node.tags)
        if not access(tags) or (tags.get('barrier') not in (None, 'no', 'entrance', 'bollard', 'kerb') and tags.get('foot') not in ALLOWED):
            self.blocked.add(node.id)
        if tags.get('railway') in {'station', 'halt'} and node.location.valid() and self.inside(node.location.lat, node.location.lon):
            self.stations.append([node.location.lat, node.location.lon])

    def way(self, way):
        direction = flags(dict(way.tags))
        if not direction:
            return
        if any(not n.location.valid() for n in way.nodes):
            self.incomplete += 1
            return
        if not any(self.inside(n.lat, n.lon) for n in way.nodes):
            return
        self.ways.append((str(way.id), direction, [(n.ref, n.lat, n.lon) for n in way.nodes]))

    def relation(self, relation):
        tags = dict(relation.tags)
        if tags.get('type') == 'restriction:foot' or tags.get('restriction:foot') or tags.get('restriction:foot:conditional'):
            # ponytail: exclude member ways; model forbidden transitions when foot restrictions need finer support.
            self.excluded_ways.update(str(m.ref) for m in relation.members if m.type == 'w')

    def graph(self, region, version):
        nodes, edges, indexes = [], [], {}
        for way, direction, refs in self.ways:
            if way in self.excluded_ways:
                continue
            for a, b in zip(refs, refs[1:]):
                if a[0] in self.blocked or b[0] in self.blocked or a[0] == b[0] or a[1:] == b[1:]:
                    continue
                pair = []
                for ref, lat, lon in (a,b):
                    if ref not in indexes:
                        indexes[ref] = len(nodes)
                        nodes.append([lat,lon])
                    pair.append(indexes[ref])
                edges.append([*pair, way, direction])
        if not edges:
            raise ValueError('No walkable edges found in this region')
        return {'version':1, 'region':region, 'dataVersion':version, 'bounds':self.bounds,
                'nodes':nodes, 'edges':edges, 'stations':self.stations}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--region', required=True)
    parser.add_argument('--bounds', nargs=4, type=float, required=True, metavar=('WEST','SOUTH','EAST','NORTH'))
    args = parser.parse_args()
    west,south,east,north = args.bounds
    if not all(math.isfinite(n) for n in args.bounds) or not (-180 <= west < east <= 180 and -80 <= south < north <= 80):
        parser.error('Invalid bounds (latitude must be within ±80 degrees)')
    with args.input.open('rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    importer = Importer(args.bounds)
    importer.apply_file(str(args.input), locations=True, idx='flex_mem')
    # The importer source hash captures the walking policy, not just source OSM data.
    policy = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()[:12]
    graph = importer.graph(args.region, f'{digest[:16]}-{policy}')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix('.json.tmp')
    with temporary.open('w') as output:
        json.dump(graph, output, separators=(',',':'), allow_nan=False)
    temporary.replace(args.output)
    print(json.dumps({'nodes':len(graph['nodes']), 'segments':len(graph['edges']),
                      'stations':len(graph['stations']), 'incompleteWaysSkipped':importer.incomplete,
                      'dataVersion':graph['dataVersion'], 'bytes':args.output.stat().st_size}))


if __name__ == '__main__':
    main()
