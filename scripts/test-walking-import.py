import importlib.util
import tempfile
from pathlib import Path

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

xml = '''<osm version="0.6">
<node id="1" lat="52.5" lon="13.4"/>
<node id="2" lat="52.5" lon="13.401"><tag k="barrier" v="gate"/><tag k="access" v="private"/></node>
<node id="3" lat="52.5" lon="13.402"/>
<node id="4" lat="52.501" lon="13.4"/>
<node id="5" lat="52.501" lon="13.401"/>
<way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><tag k="highway" v="footway"/></way>
<way id="11"><nd ref="1"/><nd ref="4"/><tag k="highway" v="residential"/><tag k="oneway" v="yes"/></way>
<way id="12"><nd ref="4"/><nd ref="5"/><tag k="highway" v="footway"/></way>
<relation id="20"><member type="way" ref="12" role="from"/><tag k="type" v="restriction"/><tag k="restriction:foot" v="no_entry"/></relation>
</osm>'''
with tempfile.TemporaryDirectory() as directory:
    source = Path(directory)/'fixture.osm'
    source.write_text(xml)
    importer = module.Importer([13.3,52.4,13.5,52.6])
    importer.apply_file(str(source),locations=True)
    graph = importer.graph('fixture','fixture')
    assert len(graph['edges']) == 1, graph
    assert graph['edges'][0][2:] == ['11',3]
print('Importer access, direction, barrier and pedestrian-restriction checks passed.')
