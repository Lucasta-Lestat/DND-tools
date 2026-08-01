extends RefCounted

## Assembles a square room out of four corner primitives, the smallest end-to-end
## exercise of cut → branch glue → loop glue → complete.

var t


func _square_labels() -> Dictionary:
	var labels := DGGLabels.new()
	var room := labels.face_id("room")
	var void_ := labels.face_id("void")
	# Corners of the unit square, counter-clockwise, room inside.
	# Each entry is the outward direction of a spoke plus the faces either side of
	# that outward ray.
	return {
		"labels": labels,
		"A": [labels.spoke_head(room, void_, 0.0), labels.spoke_head(void_, room, 90.0)],
		"B": [labels.spoke_head(void_, room, 180.0), labels.spoke_head(room, void_, 90.0)],
		"C": [labels.spoke_head(room, void_, 180.0), labels.spoke_head(void_, room, -90.0)],
		"D": [labels.spoke_head(void_, room, 0.0), labels.spoke_head(room, void_, -90.0)],
	}


func _find_head(g: DGGGraph, head: int) -> int:
	return Array(g.boundary.heads).find(head)


func test_primitive_boundary_shape() -> void:
	var s := _square_labels()
	var a := DGGGraph.from_vertex(s["labels"], s["A"])
	t.eq(a.vertex_count, 1, "a primitive is one vertex")
	t.eq(a.dangling_count(), 2, "with every incident edge cut")
	t.eq(Array(a.boundary.turns), [0, 1], "half-edges in CCW order then a single ∧")
	t.eq(a.boundary.total_turn(), 1, "loops once")


func test_primitive_sorts_spokes_counter_clockwise() -> void:
	var labels := DGGLabels.new()
	var f := labels.face_id("f")
	var g := labels.face_id("g")
	var east := labels.spoke_head(f, g, 0.0)
	var north := labels.spoke_head(f, g, 90.0)
	var south := labels.spoke_head(f, g, -90.0)
	var v := DGGGraph.from_vertex(labels, [north, east, south])
	var dirs: Array[float] = []
	for h in v.boundary.heads:
		dirs.append(labels.head_direction(h))
	t.eq(dirs, [-90.0, 0.0, 90.0], "spokes are ordered counter-clockwise from -180°")


func test_complementary_half_edges_pair_up() -> void:
	var s := _square_labels()
	var labels: DGGLabels = s["labels"]
	t.eq(labels.edge_count(), 4, "a square has four distinct edge labels")
	t.ok(DGGBoundary.are_complementary(s["A"][0], s["B"][0]),
			"A's east spoke complements B's west spoke")
	t.ok(DGGBoundary.are_complementary(s["A"][1], s["D"][1]),
			"A's north spoke complements D's south spoke")
	t.ok(not DGGBoundary.are_complementary(s["A"][0], s["C"][0]),
			"the bottom and top edges are not the same label — the room is on "
			+ "opposite sides of them")


func test_square_assembles_and_closes() -> void:
	var s := _square_labels()
	var labels: DGGLabels = s["labels"]
	var a := DGGGraph.from_vertex(labels, s["A"])
	var b := DGGGraph.from_vertex(labels, s["B"])
	var c := DGGGraph.from_vertex(labels, s["C"])
	var d := DGGGraph.from_vertex(labels, s["D"])

	var ab := a.branch_glued(b, _find_head(a, s["A"][0]), _find_head(b, s["B"][0]))
	t.eq(ab.vertex_count, 2, "branch gluing merges two graphs")
	t.eq(ab.dangling_count(), 2, "consuming one half-edge from each")

	var abc := ab.branch_glued(c, _find_head(ab, s["B"][1]), _find_head(c, s["C"][1]))
	var abcd := abc.branch_glued(d, _find_head(abc, s["C"][0]), _find_head(d, s["D"][0]))
	t.eq(abcd.vertex_count, 4, "four corners")
	t.eq(abcd.edge_count(), 3, "three sides glued so far")
	t.eq(abcd.dangling_count(), 2, "the fourth side is still two half-edges")

	# The two survivors are the ends of the missing side, so the last join is a
	# loop glue: it closes a cycle rather than merging two graphs.
	var sites := abcd.loop_glue_sites()
	t.eq(sites.size(), 1, "exactly one legal loop glue closes the square")
	var square := abcd.loop_glued(sites[0])
	t.ok(square.is_complete(), "∂G = ∧: nothing left to glue")
	t.eq(square.vertex_count, 4, "still four corners")
	t.eq(square.edge_count(), 4, "now four sides")


func test_canonical_key_identifies_isomorphic_graphs() -> void:
	var s := _square_labels()
	var labels: DGGLabels = s["labels"]
	var a1 := DGGGraph.from_vertex(labels, s["A"])
	var a2 := DGGGraph.from_vertex(labels, [s["A"][1], s["A"][0]])
	t.eq(a2.canonical_key(), a1.canonical_key(), "spoke input order does not matter")
	var b := DGGGraph.from_vertex(labels, s["B"])
	t.ok(b.canonical_key() != a1.canonical_key(), "different corners are different graphs")
