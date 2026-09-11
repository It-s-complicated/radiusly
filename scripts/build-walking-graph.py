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
STATIONS = {'station', 'halt'}


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


def is_station(tags):
    return tags.get('railway') in STATIONS


def center(points):
    return [(min(p[0] for p in points)+max(p[0] for p in points))/2,
            (min(p[1] for p in points)+max(p[1] for p in points))/2]


class StationRelations(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.relations = {}

    def relation(self, relation):
        if is_station(dict(relation.tags)):
            self.relations[str(relation.id)] = [(member.type, member.ref) for member in relation.members]


class Importer(osmium.SimpleHandler):
    def __init__(self, bounds):
        super().__init__()
        self.bounds = bounds
        west, south, east, north = bounds
        # 25 km data buffer around supported starts; maximum accepted walk is 37.5 km.
        dy = 25000 / 110000
        dx = dy / math.cos(math.radians(max(abs(south), abs(north))))
        self.buffered_bounds = (west-dx, south-dy, east+dx, north+dy)
        self.blocked = set()
        self.excluded_ways = set()
        self.ways = []
        self.stations = []
        self.station_members = {}
        self.station_relation_points = {}
        self.incomplete = 0

    def apply_file(self, filename, **kwargs):
        # ponytail: two passes avoid retaining every OSM node; use an area handler if I/O becomes the bottleneck.
        relations = StationRelations()
        relations.apply_file(filename)
        self.station_relation_points = {relation: [] for relation in relations.relations}
        for relation, members in relations.relations.items():
            for kind, ref in members:
                if kind in {'n', 'w'}:
                    self.station_members.setdefault((kind, ref), []).append(relation)
        return super().apply_file(filename, **kwargs)

    def inside(self, lat, lon):
        west, south, east, north = self.buffered_bounds
        return west <= lon <= east and south <= lat <= north

    def node(self, node):
        tags = dict(node.tags)
        if not access(tags) or (tags.get('barrier') not in (None, 'no', 'entrance', 'bollard', 'kerb') and tags.get('foot') not in ALLOWED):
            self.blocked.add(node.id)
        if node.location.valid():
            point = [node.location.lat, node.location.lon]
            if is_station(tags) and self.inside(*point):
                self.stations.append(point)
            for relation in self.station_members.get(('n', node.id), []):
                self.station_relation_points[relation].append(point)

    def way(self, way):
        tags = dict(way.tags)
        direction = flags(tags)
        station = is_station(tags)
        relations = self.station_members.get(('w', way.id), [])
        if not direction and not station and not relations:
            return
        refs = [(node.ref, node.lat, node.lon) for node in way.nodes if node.location.valid()]
        if refs and (station or relations):
            points = [[lat, lon] for _, lat, lon in refs]
            if station:
                point = center(points)
                if self.inside(*point):
                    self.stations.append(point)
            for relation in relations:
                self.station_relation_points[relation].extend(points)
        if not direction:
            return
        if len(refs) != len(way.nodes):
            self.incomplete += 1
            return
        if not any(self.inside(lat, lon) for _, lat, lon in refs):
            return
        self.ways.append((str(way.id), direction, refs))

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
        stations = [*self.stations]
        for points in self.station_relation_points.values():
            if points:
                point = center(points)
                if self.inside(*point):
                    stations.append(point)
        return {'version':1, 'region':region, 'dataVersion':version, 'bounds':self.bounds,
                'nodes':nodes, 'edges':edges, 'stations':stations}


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
