extends RefCounted

## Checks that hand-authored room polygons turn into a sound plane graph, and
## that cutting it up produces the primitives the algorithm expects.

var t


func test_two_cells_form_a_clean_arrangement() -> void:
	var ex := DGGExample.from_file("res://examples/cells.json")
	t.ok(ex != null, "cells.json loads")
	t.eq(Array(ex.warnings), [], "the polygons tile without gaps or overlaps")
	t.eq(ex.graph.vertex_count, 6, "four outer corners and two T-junctions")
	t.eq(ex.graph.edge_count(), 7, "six outer walls plus the shared one")
	t.eq(ex.labels.face_names.size(), 2, "two face labels: rock and cell")
	t.eq(ex.labels.face_name(0), "rock", "the outer face is interned first")


func test_primitives_cover_every_vertex() -> void:
	var ex := DGGExample.from_file("res://examples/cells.json")
	var total := 0
	for c in ex.primitive_counts:
		total += c
	t.eq(total, ex.graph.vertex_count, "every vertex is accounted for by a primitive")
	for prim in ex.primitives:
		t.ok(prim.vertex_count == 1, "a primitive is a single vertex")
		t.ok(prim.dangling_count() >= 2, "with all its edges cut")
		t.eq(prim.boundary.total_turn(), 1, "and a well-formed boundary")


func test_shared_wall_has_the_same_face_on_both_sides() -> void:
	var ex := DGGExample.from_file("res://examples/cells.json")
	var cell := ex.labels.face_id("cell")
	var shared := 0
	for s in ex.graph.spoke_count():
		var h: int = ex.graph.spoke_head[s]
		if ex.labels.head_left_face(h) == cell and ex.labels.head_right_face(h) == cell:
			shared += 1
	t.eq(shared, 2, "the middle wall is cell|cell, seen from both ends")


func test_auto_split_of_partially_shared_walls() -> void:
	# The hall's top wall runs from x=0 to x=6 but only parts of it back onto
	# chambers. Authors should not have to subdivide by hand.
	var ex := DGGExample.from_file("res://examples/warren.json")
	t.eq(Array(ex.warnings), [], "warren tiles cleanly after auto-splitting")
	t.ok(ex.graph.vertex_count >= 14, "walls were split at the touching corners")
	for v in ex.graph.vertex_count:
		t.ok((ex.graph.vertex_spokes[v] as PackedInt32Array).size() >= 2,
				"no dead-end vertices in a closed floorplan")


func test_clockwise_polygons_are_accepted() -> void:
	var cw := DGGExample.from_dict({
		"name": "cw",
		"rooms": [{"label": "room", "polygon": [[0, 0], [0, 2], [2, 2], [2, 0]]}],
	})
	t.eq(Array(cw.warnings), [], "a clockwise room is rewound, not rejected")
	t.eq(cw.graph.edge_count(), 4, "and still yields four walls")
