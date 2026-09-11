import importlib.util
import tempfile
from pathlib import Path
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('walking_import', Path(__file__).with_name('build-walking-graph.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

assert module.flags({'highway':'residential','oneway':'yes'}) == 3
assert module.flags({'highway':'footway','oneway:foot':'yes'}) == 1
assert module.flags({'highway':'path','access':'private'}) == 0
assert module.flags({'highway':'path','access':'private','foot':'yes'}) == 3
assert module.flags({'highway':'footway','foot:conditional':'yes @ (Mo-Fr)'}) == 0
assert module.flags({'highway':'pedestrian','area':'yes'}) == 0
assert module.flags({'highway':'footway','foot:backward':'no'}) == 1
assert module.flags({'highway':'footway','oneway':'yes'}) == 0

# Irrelevant ways must not access coordinates at all.
importer = module.Importer([13.3,52.4,13.5,52.6])
importer.way(SimpleNamespace(id=100, tags={'building':'yes'}))
west, south, east, north = importer.buffered_bounds
assert importer.inside(south, west) and importer.inside(north, east)
assert not importer.inside(south - 0.000001, west)
assert not importer.inside(north, east + 0.000001)

# Missing locations still exclude walking ways but preserve valid station points.
valid = SimpleNamespace(ref=1, lat=52.5, lon=13.4,
                        location=SimpleNamespace(valid=lambda: True))
missing = SimpleNamespace(location=SimpleNamespace(valid=lambda: False))
importer.station_members[('w', 101)] = ['200']
importer.station_relation_points['200'] = []
importer.way(SimpleNamespace(id=101, tags={'highway':'footway', 'railway':'station'},
                             nodes=[valid, missing]))
assert importer.incomplete == 1 and not importer.ways
assert importer.stations == [[52.5,13.4]]
assert importer.station_relation_points['200'] == [[52.5,13.4]]
outside = SimpleNamespace(ref=2, lat=0, lon=0,
                          location=SimpleNamespace(valid=lambda: True))
importer.way(SimpleNamespace(id=102, tags={'highway':'footway'}, nodes=[outside]))
assert not importer.ways
importer.way(SimpleNamespace(id=103, tags={'highway':'footway'}, nodes=[valid, outside]))
assert importer.ways == [('103', 3, [(1,52.5,13.4), (2,0,0)])]

xml = '''<osm version="0.6">
<node id="1" lat="52.5" lon="13.4"/>
<node id="2" lat="52.5" lon="13.401"><tag k="barrier" v="gate"/><tag k="access" v="private"/></node>
<node id="3" lat="52.5" lon="13.402"/>
<node id="4" lat="52.501" lon="13.4"/>
<node id="5" lat="52.501" lon="13.401"/>
<node id="6" lat="52.502" lon="13.4"><tag k="railway" v="halt"/></node>
<node id="7" lat="52.503" lon="13.4"/>
<node id="8" lat="52.503" lon="13.402"/>
<node id="9" lat="52.504" lon="13.4"/>
<node id="10" lat="52.504" lon="13.402"/>
<node id="11" lat="52.505" lon="13.4"/>
<node id="12" lat="52.505" lon="13.402"><tag k="name" v="Station member"/></node>
<way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><tag k="highway" v="footway"/></way>
<way id="11"><nd ref="1"/><nd ref="4"/><tag k="highway" v="residential"/><tag k="oneway" v="yes"/></way>
<way id="12"><nd ref="4"/><nd ref="5"/><tag k="highway" v="footway"/></way>
<way id="30"><nd ref="7"/><nd ref="8"/><tag k="railway" v="station"/></way>
<way id="31"><nd ref="9"/><nd ref="10"/></way>
<relation id="20"><member type="way" ref="12" role="from"/><tag k="type" v="restriction"/><tag k="restriction:foot" v="no_entry"/></relation>
<relation id="21"><member type="way" ref="31" role="outer"/><tag k="type" v="multipolygon"/><tag k="railway" v="station"/></relation>
<relation id="22"><member type="node" ref="11" role="stop"/><member type="node" ref="12" role="stop"/><tag k="railway" v="station"/></relation>
<relation id="23"><member type="node" ref="999" role="stop"/><tag k="railway" v="station"/></relation>
<relation id="24"><member type="node" ref="6" role="stop"/><member type="way" ref="31" role="outer"/><tag k="railway" v="station"/></relation>
</osm>'''
# Every access key used by node() must pass the native filter, even on its own.
for ref, (key, value) in enumerate([
    ('foot:conditional', 'yes @ (Mo-Fr)'), ('access:conditional', 'yes @ (Mo-Fr)'),
    ('opening_hours', 'Mo-Fr'), ('foot', 'no'), ('access', 'private'), ('barrier', 'gate'),
], start=100):
    xml = xml.replace('<way id="10">',
                      f'<node id="{ref}" lat="52.5" lon="13.4"><tag k="{key}" v="{value}"/></node>\n<way id="10">')
with tempfile.TemporaryDirectory() as directory:
    source = Path(directory)/'fixture.osm'
    source.write_text(xml)
    importer = module.Importer([13.3,52.4,13.5,52.6])
    importer.apply_file(str(source),locations=True)
    assert set(range(100, 106)) <= importer.blocked
    graph = importer.graph('fixture','fixture')
    assert len(graph['edges']) == 1, graph
    assert graph['edges'][0][2:] == ['11',3]
    assert graph['stations'] == [[52.502,13.4], [52.503,13.401], [52.504,13.401],
                                 [52.505,13.401], [52.503,13.401]], graph
print('Importer access, direction, barrier, restriction and station checks passed.')
