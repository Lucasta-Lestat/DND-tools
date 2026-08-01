@tool
class_name DGGTopology
extends RefCounted

## The dungeon as a player experiences it: rooms and the doorways between them.
##
## The graph the grammar works on is the [i]wall[/i] arrangement — vertices are
## corners, edges are wall segments, faces are rooms. That is the right model for
## local similarity, and the wrong one for almost every question a designer asks.
## "Is this a loop or a branching tree?", "can you get from the entrance to the
## vault?", "how deep does it go?" are all questions about the [b]dual[/b]: rooms
## as nodes, doorways as links.
##
## The distinction matters more than it sounds. Cycle rank on the wall graph
## ([code]E - V + 1[/code]) looks like a loopiness measure but, for a connected
## plane graph, equals the bounded-face count exactly — it is the room count in
## disguise, and constraining it just constrains size. The number that separates a
## donut from a pile of spaghetti is the cycle rank of the room-adjacency graph,
## and that is what [member loop_count] reports.
##
## Everything here is a property local similarity cannot see. Two dungeons can be
## locally identical and differ in every measure below.

## Bounded faces whose label is not the outer face.
var room_count: int = 0
## Bounded faces that ARE the outer label: sealed voids inside the footprint. A
## dungeon with a pocket has a hole in it in the everyday sense.
var pocket_count: int = 0
## Passable edges between two rooms.
var door_count: int = 0
## Passable edges between a room and the outside: ways in.
var entrance_count: int = 0
## Independent loops in the room-adjacency graph. 0 is a tree, 1 is a single
## circuit — a donut — and higher is a braid.
var loop_count: int = 0
## Connected components of the room-adjacency graph. More than one means rooms a
## player cannot walk between, however close they look.
var region_count: int = 0
## Rooms reachable from outside through doorways.
var reachable_count: int = 0
## Longest shortest-path between two rooms in the same region, in doorways.
var depth: int = 0
## Rooms with exactly one doorway.
var dead_end_count: int = 0

## Per room, the rooms it connects to. Index matches [member room_faces].
var adjacency: Array = []
## Face index in [method DGGGraph.face_cycles] for each room.
var room_faces: PackedInt32Array = PackedInt32Array()

const OUTSIDE := -1


## [param with_depth] controls the all-pairs search behind [member depth]. It is
## the only quadratic step here and nothing in [DGGGoals] reads it, so the
## generator leaves it off in its inner loop and turns it on for reporting.
static func analyse(graph: DGGGraph, outer_face: int, with_depth: bool = true) -> DGGTopology:
	var t := DGGTopology.new()
	if graph == null or graph.spoke_count() == 0:
		return t
	t._build(graph, outer_face, with_depth)
	return t


func _build(graph: DGGGraph, outer_face: int, with_depth: bool) -> void:
	var walk := graph.face_cycles()
	var cycles: Array = walk["cycles"]
	var face_of_spoke: PackedInt32Array = walk["face_of_spoke"]

	# Classify each face. Bounded faces run clockwise, so their signed area is
	# negative; exactly one face — the unbounded outside — runs the other way.
	var room_of_face := PackedInt32Array()
	room_of_face.resize(cycles.size())
	room_of_face.fill(OUTSIDE)
	# A freshly spliced graph has coordinates for the vertices it kept and none for
	# the ones just inserted, so "has a vertex_pos array" is not the same as "is
	# drawn". Only trust the areas when every position is finite.
	var placed := graph.vertex_pos.size() == graph.vertex_count
	if placed:
		for p in graph.vertex_pos:
			if is_inf(p.x) or is_inf(p.y) or is_nan(p.x) or is_nan(p.y):
				placed = false
				break
	for i in cycles.size():
		var spokes: PackedInt32Array = cycles[i]
		if spokes.is_empty():
			continue
		var label := graph.labels.head_right_face(graph.spoke_head[spokes[0]])
		var bounded := true
		if placed:
			bounded = _signed_area(graph, spokes) < 0.0
		else:
			# Without coordinates, fall back on the walk's turning: a bounded face
			# turns one way round and the unbounded one the other.
			bounded = _turning(graph, spokes) < 0.0
		if not bounded:
			continue
		if label == outer_face:
			pocket_count += 1
			continue
		room_of_face[i] = room_faces.size()
		room_faces.append(i)
	room_count = room_faces.size()

	adjacency = []
	for r in room_count:
		adjacency.append(PackedInt32Array())

	# One pass over the passable edges. Each has a face on either side; if both are
	# rooms it is a doorway, if one is the outside it is an entrance.
	var seen := {}
	for s in graph.spoke_count():
		var p: int = graph.spoke_partner[s]
		if p < 0 or seen.has(s):
			continue
		seen[s] = true
		seen[p] = true
		if not graph.labels.edge_is_passable(DGGLabels.head_edge(graph.spoke_head[s])):
			continue
		var a := room_of_face[face_of_spoke[s]] if face_of_spoke[s] >= 0 else OUTSIDE
		var b := room_of_face[face_of_spoke[p]] if face_of_spoke[p] >= 0 else OUTSIDE
		if a == OUTSIDE and b == OUTSIDE:
			continue
		if a == OUTSIDE or b == OUTSIDE:
			entrance_count += 1
			continue
		if a == b:
			continue  # a doorway in a wall the same room lies on both sides of
		door_count += 1
		# Packed arrays are value types, so a nested append has to be written back.
		var links_a: PackedInt32Array = adjacency[a]
		links_a.append(b)
		adjacency[a] = links_a
		var links_b: PackedInt32Array = adjacency[b]
		links_b.append(a)
		adjacency[b] = links_b

	for r in room_count:
		if (adjacency[r] as PackedInt32Array).size() == 1:
			dead_end_count += 1
	_measure_shape(graph, room_of_face, face_of_spoke, with_depth)


## Components, loops and depth of the room-adjacency graph.
func _measure_shape(graph: DGGGraph, room_of_face: PackedInt32Array,
		face_of_spoke: PackedInt32Array, with_depth: bool) -> void:
	if room_count == 0:
		return
	var component := PackedInt32Array()
	component.resize(room_count)
	component.fill(-1)
	for start in room_count:
		if component[start] >= 0:
			continue
		var queue: Array[int] = [start]
		component[start] = region_count
		var qi := 0
		while qi < queue.size():
			var r: int = queue[qi]
			qi += 1
			for n in (adjacency[r] as PackedInt32Array):
				if component[n] < 0:
					component[n] = region_count
					queue.append(n)
		region_count += 1
	# Cycle rank of the dual: doorways minus rooms plus components.
	loop_count = door_count - room_count + region_count

	# Reachability: which rooms an entrance actually leads to.
	var entered := {}
	for s in graph.spoke_count():
		var p: int = graph.spoke_partner[s]
		if p < 0:
			continue
		if not graph.labels.edge_is_passable(DGGLabels.head_edge(graph.spoke_head[s])):
			continue
		var a := room_of_face[face_of_spoke[s]] if face_of_spoke[s] >= 0 else OUTSIDE
		var b := room_of_face[face_of_spoke[p]] if face_of_spoke[p] >= 0 else OUTSIDE
		if a == OUTSIDE and b >= 0:
			entered[component[b]] = true
		elif b == OUTSIDE and a >= 0:
			entered[component[a]] = true
	for r in room_count:
		if entered.has(component[r]):
			reachable_count += 1

	if not with_depth:
		return
	# Depth: the longest shortest-path, found by breadth-first search from each
	# room. Quadratic, and the only measurement here that is.
	for start in room_count:
		var dist := PackedInt32Array()
		dist.resize(room_count)
		dist.fill(-1)
		dist[start] = 0
		var queue: Array[int] = [start]
		var qi := 0
		while qi < queue.size():
			var r: int = queue[qi]
			qi += 1
			for n in (adjacency[r] as PackedInt32Array):
				if dist[n] < 0:
					dist[n] = dist[r] + 1
					queue.append(n)
		for d in dist:
			depth = maxi(depth, d)


static func _signed_area(graph: DGGGraph, spokes: PackedInt32Array) -> float:
	var a := 0.0
	for i in spokes.size():
		var p := graph.vertex_pos[graph.spoke_vertex[spokes[i]]]
		var q := graph.vertex_pos[graph.spoke_vertex[spokes[(i + 1) % spokes.size()]]]
		a += p.x * q.y - q.x * p.y
	return a * 0.5


static func _turning(graph: DGGGraph, spokes: PackedInt32Array) -> float:
	var total := 0.0
	var k := spokes.size()
	for i in k:
		var a := graph.labels.head_direction(graph.spoke_head[spokes[i]])
		var b := graph.labels.head_direction(graph.spoke_head[spokes[(i + 1) % k]])
		total += DGGLabels.normalize_180(b - a)
	return total


func shape_name() -> String:
	if room_count == 0:
		return "no rooms"
	if region_count > 1:
		return "%d separate regions" % region_count
	if loop_count == 0:
		return "a tree" if dead_end_count > 2 else "a corridor"
	if loop_count == 1:
		return "a single loop"
	return "%d interlocking loops" % loop_count


func summary() -> String:
	if room_count == 0:
		return "layout: %d rooms — nothing is connected, the example has no doorways" \
				% room_count
	return "layout: %d rooms, %d doorways, %d entrance(s) — %s%s\n  %d loop(s), depth %d, %d dead end(s)%s" % [
		room_count, door_count, entrance_count, shape_name(),
		"" if pocket_count == 0 else ", %d sealed pocket(s)" % pocket_count,
		loop_count, depth, dead_end_count,
		"" if reachable_count == room_count
				else ", %d room(s) unreachable from outside" % (room_count - reachable_count),
	]
