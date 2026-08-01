@tool
class_name DGGExample
extends RefCounted

## An example dungeon: the hand-authored floorplan a grammar is learned from.
##
## Authors give rooms as polygons. This class turns them into the labelled plane
## graph the algorithm works on, then cuts that graph into primitives (§4.1) —
## one per vertex, every incident edge severed. Those primitives are the only
## thing the grammar ever sees; everything generated afterwards is some
## reassembly of them, which is precisely what makes the output locally similar
## to the input.

const SNAP_DEFAULT := 0.001

var name: String = "example"
var labels: DGGLabels
var graph: DGGGraph
## Distinct primitives, deduplicated by [method DGGGraph.canonical_key].
var primitives: Array[DGGGraph] = []
## How many vertices of the example each distinct primitive accounts for.
var primitive_counts: PackedInt32Array = PackedInt32Array()
var face_colors: Dictionary = {}
var outer_face: String = "void"
var min_edge_length: float = 1.0
var max_edge_length: float = 8.0
## Non-fatal problems found while building the arrangement.
var warnings: PackedStringArray = PackedStringArray()

var _snap: float = SNAP_DEFAULT
var _points: PackedVector2Array = PackedVector2Array()
## Directed wall occurrences: key "u>w" → face id on the left of u→w.
var _left_of: Dictionary = {}


static func from_file(path: String) -> DGGExample:
	var text := FileAccess.get_file_as_string(path)
	if text.is_empty():
		push_error("DGGExample: cannot read %s" % path)
		return null
	var parsed = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		push_error("DGGExample: %s is not a JSON object" % path)
		return null
	var ex := from_dict(parsed)
	if ex.name == "example":
		ex.name = path.get_file().get_basename()
	return ex


static func from_dict(d: Dictionary) -> DGGExample:
	var ex := DGGExample.new()
	ex.name = d.get("name", "example")
	ex.outer_face = d.get("outer_face", "void")
	ex._snap = float(d.get("snap", SNAP_DEFAULT))
	ex.labels = DGGLabels.new()
	ex.labels.angle_epsilon = float(d.get("angle_epsilon", 0.5))
	var lengths: Dictionary = d.get("edge_length", {})
	ex.min_edge_length = float(lengths.get("min", 1.0))
	ex.max_edge_length = float(lengths.get("max", 8.0))
	# The outer face is interned first so it always has id 0.
	ex.labels.face_id(ex.outer_face)
	for room in d.get("rooms", []):
		var label: String = room.get("label", "room")
		if room.has("color"):
			ex.face_colors[label] = room["color"]
		ex._add_room(label, room.get("polygon", []))
	ex._split_edges_at_touching_vertices()
	ex._build_graph()
	ex._build_primitives()
	return ex


func to_dict() -> Dictionary:
	return {
		"name": name,
		"outer_face": outer_face,
		"snap": _snap,
		"angle_epsilon": labels.angle_epsilon,
		"edge_length": {"min": min_edge_length, "max": max_edge_length},
		"rooms": [],
	}


# --- Arrangement --------------------------------------------------------------

func _intern_point(p: Vector2) -> int:
	for i in _points.size():
		if _points[i].distance_to(p) <= _snap:
			return i
	_points.append(p)
	return _points.size() - 1


## Records one room outline. Polygons are read counter-clockwise so that the room
## always lies to the left of each of its walls; clockwise input is reversed.
func _add_room(label: String, polygon: Array) -> void:
	if polygon.size() < 3:
		warnings.append("room '%s' has fewer than 3 points and was skipped" % label)
		return
	var pts: Array[Vector2] = []
	for p in polygon:
		pts.append(Vector2(float(p[0]), float(p[1])))
	if _signed_area(pts) < 0.0:
		pts.reverse()
	var face := labels.face_id(label)
	var ids: Array[int] = []
	for p in pts:
		ids.append(_intern_point(p))
	for i in ids.size():
		var u: int = ids[i]
		var w: int = ids[(i + 1) % ids.size()]
		if u == w:
			continue
		var key := "%d>%d" % [u, w]
		if _left_of.has(key):
			warnings.append("two rooms claim the same side of a wall near %s"
					% str(_points[u]))
		_left_of[key] = face


static func _signed_area(pts: Array[Vector2]) -> float:
	var a := 0.0
	for i in pts.size():
		var p := pts[i]
		var q := pts[(i + 1) % pts.size()]
		a += p.x * q.y - q.x * p.y
	return a * 0.5


## Splits any wall that another room's corner lands in the middle of.
##
## Two rooms sharing a wall only partially — a long hall against two short cells —
## would otherwise produce walls that overlap without matching up, and the graph
## would come out non-planar. Splitting at the touching corner keeps the
## arrangement honest and saves authors from having to subdivide by hand.
func _split_edges_at_touching_vertices() -> void:
	var changed := true
	var guard := 0
	while changed and guard < 64:
		changed = false
		guard += 1
		for key in _left_of.keys():
			var parts := (key as String).split(">")
			var u := int(parts[0])
			var w := int(parts[1])
			var a := _points[u]
			var b := _points[w]
			for v in _points.size():
				if v == u or v == w:
					continue
				var p := _points[v]
				var closest := Geometry2D.get_closest_point_to_segment(p, a, b)
				if closest.distance_to(p) > _snap:
					continue
				if p.distance_to(a) <= _snap or p.distance_to(b) <= _snap:
					continue
				var face: int = _left_of[key]
				_left_of.erase(key)
				_left_of["%d>%d" % [u, v]] = face
				_left_of["%d>%d" % [v, w]] = face
				changed = true
				break
			if changed:
				break


func _build_graph() -> void:
	graph = DGGGraph.new()
	graph.labels = labels
	graph.vertex_count = _points.size()
	graph.vertex_pos = _points.duplicate()
	graph.boundary = DGGBoundary.complete()

	# One spoke per directed wall occurrence, plus the implied reverse when a wall
	# only borders one room (its far side is the outer face).
	var spoke_of := {}  # "u>w" → spoke id
	var directed: Array[Vector2i] = []
	for key in _left_of.keys():
		var parts := (key as String).split(">")
		directed.append(Vector2i(int(parts[0]), int(parts[1])))
	for d in directed.duplicate():
		var back := Vector2i(d.y, d.x)
		if not _left_of.has("%d>%d" % [back.x, back.y]):
			_left_of["%d>%d" % [back.x, back.y]] = labels.face_id(outer_face)
			directed.append(back)

	var rings: Array = []
	for i in _points.size():
		rings.append([])
	for d in directed:
		var dir := rad_to_deg((_points[d.y] - _points[d.x]).angle())
		var left: int = _left_of["%d>%d" % [d.x, d.y]]
		var right: int = _left_of["%d>%d" % [d.y, d.x]]
		var head := labels.spoke_head(left, right, dir)
		var s := graph.spoke_vertex.size()
		graph.spoke_vertex.append(d.x)
		graph.spoke_head.append(head)
		graph.spoke_partner.append(-1)
		spoke_of["%d>%d" % [d.x, d.y]] = s
		rings[d.x].append([dir, s])
	for d in directed:
		var s: int = spoke_of["%d>%d" % [d.x, d.y]]
		var p: int = spoke_of.get("%d>%d" % [d.y, d.x], -1)
		graph.spoke_partner[s] = p
		if p < 0:
			warnings.append("wall near %s has no opposite half" % str(_points[d.x]))

	graph.vertex_spokes = []
	for i in _points.size():
		var ring: Array = rings[i]
		ring.sort_custom(func(a, b): return a[0] < b[0])
		var packed := PackedInt32Array()
		for entry in ring:
			packed.append(entry[1])
		graph.vertex_spokes.append(packed)
	_check_face_consistency()


## Walking counter-clockwise round a vertex, the face to one spoke's left must be
## the face to the next spoke's right. A mismatch means the input polygons do not
## tile — usually a gap, an overlap, or a room wound the wrong way.
func _check_face_consistency() -> void:
	for v in graph.vertex_count:
		var ring: PackedInt32Array = graph.vertex_spokes[v]
		var deg := ring.size()
		if deg == 0:
			warnings.append("vertex at %s has no walls" % str(_points[v]))
			continue
		for i in deg:
			var a: int = graph.spoke_head[ring[i]]
			var b: int = graph.spoke_head[ring[(i + 1) % deg]]
			if labels.head_left_face(a) != labels.head_right_face(b):
				warnings.append("faces disagree around the corner at %s (%s vs %s)" % [
					str(_points[v]),
					labels.face_name(labels.head_left_face(a)),
					labels.face_name(labels.head_right_face(b)),
				])
				break


# --- Disassembly (§4.1) -------------------------------------------------------

func _build_primitives() -> void:
	primitives = []
	primitive_counts = PackedInt32Array()
	var seen := {}
	for v in graph.vertex_count:
		var heads: Array = []
		for s in graph.vertex_spokes[v]:
			heads.append(graph.spoke_head[s])
		if heads.is_empty():
			continue
		var prim := DGGGraph.from_vertex(labels, heads)
		var key := prim.canonical_key()
		if seen.has(key):
			primitive_counts[seen[key]] += 1
		else:
			seen[key] = primitives.size()
			primitives.append(prim)
			primitive_counts.append(1)


func summary() -> String:
	var s := "%s: %d vertices, %d edges, %d faces, %d distinct primitives" % [
		name, graph.vertex_count, graph.edge_count(),
		labels.face_names.size(), primitives.size(),
	]
	for w in warnings:
		s += "\n  warning: %s" % w
	return s
