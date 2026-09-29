use osmpbf::elements::RelMemberType;
use osmpbf::{Blob, BlobDecode, BlobReader, ByteOffset, Element, PrimitiveBlock};
use rayon::prelude::*;
use serde::{Serialize, Serializer};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet, hash_map::Entry};
use std::error::Error;
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, ErrorKind, Read, Write};
use std::path::{Path, PathBuf};

type Point = [f64; 2];

#[derive(Default)]
struct Tags<'a> {
    highway: Option<&'a str>,
    railway: Option<&'a str>,
    foot: Option<&'a str>,
    access: Option<&'a str>,
    foot_conditional: Option<&'a str>,
    access_conditional: Option<&'a str>,
    opening_hours: Option<&'a str>,
    area: Option<&'a str>,
    construction: Option<&'a str>,
    indoor: Option<&'a str>,
    conveying: Option<&'a str>,
    oneway_foot: Option<&'a str>,
    oneway: Option<&'a str>,
    oneway_foot_conditional: Option<&'a str>,
    foot_forward_conditional: Option<&'a str>,
    foot_backward_conditional: Option<&'a str>,
    foot_forward: Option<&'a str>,
    foot_backward: Option<&'a str>,
    barrier: Option<&'a str>,
    relation_type: Option<&'a str>,
    restriction_foot: Option<&'a str>,
    restriction_foot_conditional: Option<&'a str>,
}

impl<'a> Tags<'a> {
    fn read(tags: impl Iterator<Item = (&'a str, &'a str)>) -> Self {
        let mut result = Self::default();
        for (key, value) in tags {
            match key {
                "highway" => result.highway = Some(value),
                "railway" => result.railway = Some(value),
                "foot" => result.foot = Some(value),
                "access" => result.access = Some(value),
                "foot:conditional" => result.foot_conditional = Some(value),
                "access:conditional" => result.access_conditional = Some(value),
                "opening_hours" => result.opening_hours = Some(value),
                "area" => result.area = Some(value),
                "construction" => result.construction = Some(value),
                "indoor" => result.indoor = Some(value),
                "conveying" => result.conveying = Some(value),
                "oneway:foot" => result.oneway_foot = Some(value),
                "oneway" => result.oneway = Some(value),
                "oneway:foot:conditional" => result.oneway_foot_conditional = Some(value),
                "foot:forward:conditional" => result.foot_forward_conditional = Some(value),
                "foot:backward:conditional" => result.foot_backward_conditional = Some(value),
                "foot:forward" => result.foot_forward = Some(value),
                "foot:backward" => result.foot_backward = Some(value),
                "barrier" => result.barrier = Some(value),
                "type" => result.relation_type = Some(value),
                "restriction:foot" => result.restriction_foot = Some(value),
                "restriction:foot:conditional" => result.restriction_foot_conditional = Some(value),
                _ => {}
            }
        }
        result
    }
}

fn present(value: Option<&str>) -> bool {
    value.is_some_and(|value| !value.is_empty())
}

fn allowed(value: &str) -> bool {
    matches!(value, "yes" | "designated" | "permissive" | "official")
}

fn access(tags: &Tags<'_>) -> bool {
    !present(tags.foot_conditional)
        && !present(tags.access_conditional)
        && !present(tags.opening_hours)
        && allowed(tags.foot.or(tags.access).unwrap_or("yes"))
}

fn station(tags: &Tags<'_>) -> bool {
    matches!(tags.railway, Some("station" | "halt"))
}

fn highway(value: Option<&str>) -> bool {
    matches!(
        value,
        Some(
            "footway"
                | "path"
                | "pedestrian"
                | "steps"
                | "living_street"
                | "residential"
                | "service"
                | "unclassified"
                | "tertiary"
                | "tertiary_link"
                | "secondary"
                | "secondary_link"
                | "primary"
                | "primary_link"
                | "track"
        )
    )
}

fn flags(tags: &Tags<'_>) -> u8 {
    if !highway(tags.highway)
        || !access(tags)
        || tags.area == Some("yes")
        || present(tags.construction)
        || tags.indoor == Some("yes")
        || !matches!(tags.conveying, None | Some("no"))
        || tags.foot == Some("use_sidepath")
    {
        return 0;
    }
    if matches!(
        tags.highway,
        Some("primary" | "primary_link" | "secondary" | "secondary_link")
    ) && !tags.foot.is_some_and(allowed)
    {
        return 0;
    }
    if present(tags.oneway_foot_conditional)
        || present(tags.foot_forward_conditional)
        || present(tags.foot_backward_conditional)
        || (tags.oneway_foot.is_none()
            && matches!(
                tags.highway,
                Some("footway" | "path" | "pedestrian" | "steps")
            )
            && matches!(tags.oneway, Some("yes" | "1" | "-1")))
    {
        return 0;
    }
    let mut direction = match tags.oneway_foot {
        Some("yes" | "1") => 1,
        Some("-1") => 2,
        None | Some("no" | "0" | "false") => 3,
        _ => return 0,
    };
    if !allowed(tags.foot_forward.unwrap_or("yes")) {
        direction &= !1;
    }
    if !allowed(tags.foot_backward.unwrap_or("yes")) {
        direction &= !2;
    }
    direction
}

fn blocked(tags: &Tags<'_>) -> bool {
    !access(tags)
        || (tags
            .barrier
            .is_some_and(|value| !matches!(value, "no" | "entrance" | "bollard" | "kerb"))
            && !tags.foot.is_some_and(allowed))
}

#[derive(Clone, Copy)]
struct Bounds {
    original: [f64; 4],
    buffered: [f64; 4],
}

impl Bounds {
    fn new(original: [f64; 4]) -> Result<Self, Box<dyn Error>> {
        let [west, south, east, north] = original;
        if !original.iter().all(|n| n.is_finite())
            || !(-180.0..=180.0).contains(&west)
            || east > 180.0
            || west >= east
            || south < -80.0
            || north > 80.0
            || south >= north
        {
            return Err("Invalid bounds (latitude must be within ±80 degrees)".into());
        }
        let dy = 25000.0 / 110000.0;
        let dx = dy / south.abs().max(north.abs()).to_radians().cos();
        Ok(Self {
            original,
            buffered: [west - dx, south - dy, east + dx, north + dy],
        })
    }

    fn contains(&self, [lat, lon]: Point) -> bool {
        let [west, south, east, north] = self.buffered;
        (west..=east).contains(&lon) && (south..=north).contains(&lat)
    }
}

fn valid([lat, lon]: Point) -> bool {
    lat.is_finite() && lon.is_finite() && lat.abs() <= 90.0 && lon.abs() <= 180.0
}

fn center(points: impl IntoIterator<Item = Point>) -> Option<Point> {
    let mut min_lat = f64::INFINITY;
    let mut max_lat = f64::NEG_INFINITY;
    let mut min_lon = f64::INFINITY;
    let mut max_lon = f64::NEG_INFINITY;
    for [lat, lon] in points {
        min_lat = min_lat.min(lat);
        max_lat = max_lat.max(lat);
        min_lon = min_lon.min(lon);
        max_lon = max_lon.max(lon);
    }
    (min_lat != f64::INFINITY).then_some([(min_lat + max_lat) / 2.0, (min_lon + max_lon) / 2.0])
}

struct Way {
    id: i64,
    direction: u8,
    station: bool,
    refs: Vec<i64>,
}

struct WayId(i64);

impl Serialize for WayId {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(itoa::Buffer::new().format(self.0))
    }
}

#[derive(Serialize)]
struct Edge(u32, u32, WayId, u8);

#[derive(Serialize)]
struct Graph<'a> {
    version: u8,
    region: &'a str,
    #[serde(rename = "dataVersion")]
    data_version: &'a str,
    bounds: [f64; 4],
    nodes: Vec<Point>,
    edges: Vec<Edge>,
    stations: Vec<Point>,
}

impl Graph<'_> {
    // Keep these limits aligned with WalkingGraph in src/lib/server/routing/graph.ts.
    // Validate before publication so unsupported data cannot replace a working graph.
    fn validate(&self) -> Result<(), Box<dyn Error>> {
        if self.edges.is_empty() {
            return Err("No walkable edges found in this region".into());
        }
        for &point in self.nodes.iter().chain(&self.stations) {
            if !valid(point) || point[0].abs() > 85.0 {
                return Err(
                    "Invalid graph coordinate (latitude must be within ±85 degrees)".into(),
                );
            }
        }
        for Edge(from, to, way, _) in &self.edges {
            let [lat1, lon1] = self.nodes[*from as usize];
            let [lat2, lon2] = self.nodes[*to as usize];
            let a = ((lat2 - lat1).to_radians() / 2.0).sin().powi(2)
                + lat1.to_radians().cos()
                    * lat2.to_radians().cos()
                    * ((lon2 - lon1).to_radians() / 2.0).sin().powi(2);
            let meters = 12_742_000.0 * a.sqrt().asin();
            if !(meters > 0.0 && meters <= 20_000.0) {
                return Err(format!(
                    "Invalid graph segment length on OSM way {}: {meters} meters",
                    way.0
                )
                .into());
            }
        }
        Ok(())
    }
}

// ponytail: eight blobs per batch bound memory; use a byte budget if large blobs cause pressure.
// Indexed parallel collection and serial visits preserve PBF order and routing tie-breaks.
fn read_blocks(
    mut blobs: impl Iterator<Item = osmpbf::Result<Blob>>,
    pool: &rayon::ThreadPool,
    mut visit: impl FnMut(ByteOffset, PrimitiveBlock) -> Result<(), Box<dyn Error>>,
) -> Result<(), Box<dyn Error>> {
    loop {
        let batch = blobs.by_ref().take(8).collect::<osmpbf::Result<Vec<_>>>()?;
        if batch.is_empty() {
            return Ok(());
        }
        let decoded: Vec<osmpbf::Result<Option<PrimitiveBlock>>> = pool.install(|| {
            batch
                .par_iter()
                .map(|blob| {
                    Ok(match blob.decode()? {
                        BlobDecode::OsmData(block) => Some(block),
                        _ => None,
                    })
                })
                .collect()
        });
        for (blob, block) in batch.into_iter().zip(decoded) {
            if let Some(block) = block? {
                visit(blob.offset().ok_or("Missing PBF block offset")?, block)?;
            }
        }
    }
}

struct Import {
    graph_nodes: HashMap<i64, Point>,
    blocked: HashSet<i64>,
    ways: Vec<Way>,
    station_nodes: Vec<Point>,
    relation_points: Vec<Vec<Point>>,
    node_members: HashMap<i64, Vec<usize>>,
    way_members: HashMap<i64, Vec<usize>>,
    excluded_ways: HashSet<i64>,
}

impl Import {
    fn read(input: &Path, bounds: Bounds) -> Result<Self, Box<dyn Error>> {
        let mut result = Self {
            graph_nodes: HashMap::new(),
            blocked: HashSet::new(),
            ways: Vec::new(),
            station_nodes: Vec::new(),
            relation_points: Vec::new(),
            node_members: HashMap::new(),
            way_members: HashMap::new(),
            excluded_ways: HashSet::new(),
        };

        // Eight concurrent blobs is also the batch limit. Respect Rayon's standard
        // override for smaller machines and single-thread regression measurements.
        let threads = std::env::var("RAYON_NUM_THREADS")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or_else(|| std::thread::available_parallelism().map_or(1, |n| n.get().min(8)));
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(threads)
            .build()?;
        let mut reader = BlobReader::from_path(input)?;
        let mut way_offsets = Vec::new();
        let mut node_offsets = Vec::new();

        // Relations precede way selection so untagged station members survive.
        // Index all element types in each block, including mixed-type blocks.
        read_blocks(reader.by_ref(), &pool, |offset, block| {
            let mut has_ways = false;
            let mut has_nodes = false;
            for group in block.groups() {
                has_ways |= group.ways().next().is_some();
                has_nodes |= group.nodes().next().is_some() || group.dense_nodes().next().is_some();
                for relation in group.relations() {
                    let tags = Tags::read(relation.tags());
                    if station(&tags) {
                        let index = result.relation_points.len();
                        result.relation_points.push(Vec::new());
                        for member in relation.members() {
                            match member.member_type {
                                RelMemberType::Node => result
                                    .node_members
                                    .entry(member.member_id)
                                    .or_default()
                                    .push(index),
                                RelMemberType::Way => result
                                    .way_members
                                    .entry(member.member_id)
                                    .or_default()
                                    .push(index),
                                RelMemberType::Relation => {}
                            }
                        }
                    }
                    if tags.relation_type == Some("restriction:foot")
                        || present(tags.restriction_foot)
                        || present(tags.restriction_foot_conditional)
                    {
                        for member in relation.members() {
                            if member.member_type == RelMemberType::Way {
                                result.excluded_ways.insert(member.member_id);
                            }
                        }
                    }
                }
            }
            if has_ways {
                way_offsets.push(offset);
            }
            if has_nodes {
                node_offsets.push(offset);
            }
            Ok(())
        })?;

        let mut needed = HashSet::new();
        needed.extend(result.node_members.keys().copied());
        read_blocks(
            way_offsets
                .into_iter()
                .map(|offset| reader.blob_from_offset(offset)),
            &pool,
            |_, block| {
                for group in block.groups() {
                    for way in group.ways() {
                        let tags = Tags::read(way.tags());
                        let direction = flags(&tags);
                        let is_station = station(&tags);
                        if direction == 0
                            && !is_station
                            && !result.way_members.contains_key(&way.id())
                        {
                            continue;
                        }
                        let refs: Vec<_> = way.refs().collect();
                        needed.extend(refs.iter().copied());
                        result.ways.push(Way {
                            id: way.id(),
                            direction,
                            station: is_station,
                            refs,
                        });
                    }
                }
                Ok(())
            },
        )?;

        // Scan every node block, not just way dependencies: standalone stations
        // also contribute to scoring. Preserve regular-then-dense order per group.
        read_blocks(
            node_offsets
                .into_iter()
                .map(|offset| reader.blob_from_offset(offset)),
            &pool,
            |_, block| {
                for group in block.groups() {
                    for element in group
                        .nodes()
                        .map(Element::Node)
                        .chain(group.dense_nodes().map(Element::DenseNode))
                    {
                        let (id, point, tags) = match element {
                            Element::Node(node) => (
                                node.id(),
                                [
                                    node.decimicro_lat() as f64 / 1e7,
                                    node.decimicro_lon() as f64 / 1e7,
                                ],
                                Tags::read(node.tags()),
                            ),
                            Element::DenseNode(node) => (
                                node.id(),
                                [
                                    node.decimicro_lat() as f64 / 1e7,
                                    node.decimicro_lon() as f64 / 1e7,
                                ],
                                Tags::read(node.tags()),
                            ),
                            _ => unreachable!(),
                        };
                        if blocked(&tags) && needed.contains(&id) {
                            result.blocked.insert(id);
                        }
                        if valid(point) {
                            if needed.contains(&id) {
                                result.graph_nodes.insert(id, point);
                            }
                            if station(&tags) && bounds.contains(point) {
                                result.station_nodes.push(point);
                            }
                        }
                    }
                }
                Ok(())
            },
        )?;
        Ok(result)
    }

    fn graph<'a>(self, bounds: Bounds, region: &'a str, version: &'a str) -> (Graph<'a>, usize) {
        let mut stations = self.station_nodes;
        let mut relation_points = self.relation_points;
        let mut nodes = Vec::new();
        let mut edges = Vec::new();
        let mut indexes = HashMap::new();
        let mut incomplete = 0;
        for way in self.ways {
            let valid_refs: Vec<_> = way
                .refs
                .iter()
                .filter_map(|id| self.graph_nodes.get(id).map(|point| (*id, *point)))
                .collect();
            if !valid_refs.is_empty() && (way.station || self.way_members.contains_key(&way.id)) {
                if way.station {
                    let point = center(valid_refs.iter().map(|(_, point)| *point)).unwrap();
                    if bounds.contains(point) {
                        stations.push(point);
                    }
                }
                if let Some(members) = self.way_members.get(&way.id) {
                    for &index in members {
                        relation_points[index].extend(valid_refs.iter().map(|(_, point)| *point));
                    }
                }
            }
            if way.direction == 0 {
                continue;
            }
            if valid_refs.len() != way.refs.len() {
                incomplete += 1;
                continue;
            }
            if !valid_refs.iter().any(|(_, point)| bounds.contains(*point))
                || self.excluded_ways.contains(&way.id)
            {
                continue;
            }
            for pair in valid_refs.windows(2) {
                let [(from_id, from), (to_id, to)] = [pair[0], pair[1]];
                if self.blocked.contains(&from_id)
                    || self.blocked.contains(&to_id)
                    || from_id == to_id
                    || from == to
                {
                    continue;
                }
                let mut index = |id, point| match indexes.entry(id) {
                    Entry::Occupied(entry) => *entry.get(),
                    Entry::Vacant(entry) => {
                        let index = nodes.len() as u32;
                        nodes.push(point);
                        *entry.insert(index)
                    }
                };
                edges.push(Edge(
                    index(from_id, from),
                    index(to_id, to),
                    WayId(way.id),
                    way.direction,
                ));
            }
        }
        for (id, members) in self.node_members {
            if let Some(&point) = self.graph_nodes.get(&id) {
                for index in members {
                    relation_points[index].push(point);
                }
            }
        }
        for points in relation_points {
            if let Some(point) = center(points)
                && bounds.contains(point)
            {
                stations.push(point);
            }
        }
        (
            Graph {
                version: 1,
                region,
                data_version: version,
                bounds: bounds.original,
                nodes,
                edges,
                stations,
            },
            incomplete,
        )
    }
}

struct Args {
    input: PathBuf,
    output: PathBuf,
    region: String,
    bounds: Bounds,
}

fn args() -> Result<Args, Box<dyn Error>> {
    let mut args = std::env::args().skip(1);
    let input = PathBuf::from(args.next().ok_or("Expected input.osm.pbf")?);
    let output = PathBuf::from(args.next().ok_or("Expected output.json")?);
    let mut region = None;
    let mut bounds = None;
    while let Some(option) = args.next() {
        match option.as_str() {
            "--region" => region = Some(args.next().ok_or("Missing --region value")?),
            "--bounds" => {
                let mut values = [0.0; 4];
                for value in &mut values {
                    *value = args.next().ok_or("Missing --bounds value")?.parse()?;
                }
                bounds = Some(Bounds::new(values)?);
            }
            _ => return Err(format!("Unknown option: {option}").into()),
        }
    }
    Ok(Args {
        input,
        output,
        region: region
            .filter(|value| !value.is_empty())
            .ok_or("Missing or empty --region")?,
        bounds: bounds.ok_or("Missing --bounds")?,
    })
}

fn digest(input: &Path) -> Result<String, Box<dyn Error>> {
    let mut source = BufReader::new(File::open(input)?);
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = source.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn validate_paths(input: &Path, output: &Path) -> Result<(), Box<dyn Error>> {
    let input = fs::canonicalize(input)?;
    let output = match fs::canonicalize(output) {
        Ok(path) => path,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if input == output {
        return Err("Input and output must be different files".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let input = fs::metadata(input)?;
        let output = fs::metadata(output)?;
        if input.dev() == output.dev() && input.ino() == output.ino() {
            return Err("Input and output must be different files".into());
        }
    }
    Ok(())
}

fn write_graph(path: &Path, graph: &Graph<'_>) -> Result<u64, Box<dyn Error>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let filename = path.file_name().ok_or("Expected an output filename")?;
    let mut attempt = 0u64;
    let (temporary, file) = loop {
        let mut name = filename.to_os_string();
        name.push(format!(".{}.{attempt}.tmp", std::process::id()));
        let temporary = path.with_file_name(name);
        match File::options()
            .write(true)
            .create_new(true)
            .open(&temporary)
        {
            Ok(file) => break (temporary, file),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => attempt += 1,
            Err(error) => return Err(error.into()),
        }
    };
    let result = (|| {
        let mut output = BufWriter::new(file);
        serde_json::to_writer(&mut output, graph)?;
        output.flush()?;
        let bytes = output.get_ref().metadata()?.len();
        drop(output);
        fs::rename(&temporary, path)?;
        Ok(bytes)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

fn run() -> Result<(), Box<dyn Error>> {
    let args = args()?;
    if args
        .input
        .extension()
        .is_none_or(|extension| extension != "pbf")
    {
        return Err("Rust graph builder accepts OSM PBF input only".into());
    }
    validate_paths(&args.input, &args.output)?;
    let source_hash = digest(&args.input)?;
    let policy_hash = format!("{:x}", Sha256::digest(include_bytes!("main.rs")));
    let version = format!("{}-{}", &source_hash[..16], &policy_hash[..12]);
    let imported = Import::read(&args.input, args.bounds)?;
    let (graph, incomplete) = imported.graph(args.bounds, &args.region, &version);
    graph.validate()?;
    let bytes = write_graph(&args.output, &graph)?;
    println!(
        "{}",
        serde_json::json!({
            "nodes": graph.nodes.len(),
            "segments": graph.edges.len(),
            "stations": graph.stations.len(),
            "incompleteWaysSkipped": incomplete,
            "dataVersion": version,
            "bytes": bytes,
        })
    );
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pedestrian_policy() {
        fn tags<'a>(pairs: &'a [(&'a str, &'a str)]) -> Tags<'a> {
            Tags::read(pairs.iter().copied())
        }
        assert_eq!(
            flags(&tags(&[("highway", "residential"), ("oneway", "yes")])),
            3
        );
        assert_eq!(
            flags(&tags(&[("highway", "footway"), ("oneway:foot", "yes")])),
            1
        );
        assert_eq!(
            flags(&tags(&[("highway", "footway"), ("oneway", "yes")])),
            0
        );
        assert_eq!(
            flags(&tags(&[("highway", "footway"), ("foot:backward", "no")])),
            1
        );
        assert_eq!(
            flags(&tags(&[("highway", "path"), ("access", "private")])),
            0
        );
        assert_eq!(flags(&tags(&[("highway", "path"), ("foot", "yes")])), 3);
        assert_eq!(flags(&tags(&[("highway", "footway"), ("area", "yes")])), 0);
        assert_eq!(
            flags(&tags(&[
                ("highway", "footway"),
                ("foot:conditional", "yes @ (Mo-Fr)")
            ])),
            0
        );
        assert!(blocked(&tags(&[
            ("barrier", "gate"),
            ("access", "private")
        ])));
        assert!(!blocked(&tags(&[("barrier", "gate"), ("foot", "yes")])));
    }
    #[test]
    fn station_relation_includes_untagged_way_and_node_members() {
        let importer = Import {
            graph_nodes: HashMap::from([(1, [52.5, 13.4]), (2, [52.6, 13.6]), (3, [52.7, 13.7])]),
            blocked: HashSet::new(),
            ways: vec![
                Way {
                    id: 10,
                    direction: 0,
                    station: false,
                    refs: vec![1, 2],
                },
                Way {
                    id: 11,
                    direction: 3,
                    station: false,
                    refs: vec![1, 3],
                },
            ],
            station_nodes: Vec::new(),
            relation_points: vec![Vec::new()],
            node_members: HashMap::from([(3, vec![0])]),
            way_members: HashMap::from([(10, vec![0])]),
            excluded_ways: HashSet::new(),
        };
        let (graph, incomplete) = importer.graph(
            Bounds::new([13.0, 52.0, 14.0, 53.0]).unwrap(),
            "fixture",
            "fixture",
        );
        assert_eq!(incomplete, 0);
        assert_eq!(graph.edges.len(), 1);
        assert_eq!(graph.stations.len(), 1);
        assert!((graph.stations[0][0] - 52.6).abs() < 1e-10);
        assert!((graph.stations[0][1] - 13.55).abs() < 1e-10);
    }
}
