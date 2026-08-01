extends RefCounted

## Covers the two things added after the generator was found to be stalling: the
## geometric half of the acceptance gate, and the up-front feasibility analysis.

var t


func test_faces_are_labelled_with_the_face_actually_walked() -> void:
	# trace_faces keeps each face on the walk's right. Getting this backwards
	# labels every face of the cells example "cell", including the surrounding
	# rock, and a renderer then floods the whole footprint with one colour.
	var ex := DGGExample.from_file("res://examples/cells.json")
	var rock := ex.labels.face_id("rock")
	var cell := ex.labels.face_id("cell")
	var rooms := 0
	var outside := 0
	for face in ex.graph.trace_faces():
		var area := _area(ex.graph, face["vertices"])
		if face["label"] == cell:
			rooms += 1
			t.ok(area < 0.0, "a room is traced clockwise (negative area)")
		elif face["label"] == rock:
			outside += 1
			t.ok(area > 0.0, "the outside is traced counter-clockwise")
	t.eq(rooms, 2, "the two cells are labelled as rooms")
	t.eq(outside, 1, "and the surrounding rock is labelled as rock")


func test_example_graphs_are_realisable() -> void:
	# Every shipped example is drawable by construction, so the geometric gate must
	# not reject one. A gate with false positives would be worse than no gate.
	for name in ["cells", "vaults", "burrow", "warren"]:
		var ex := DGGExample.from_file("res://examples/%s.json" % name)
		t.ok(ex.graph.faces_are_realisable(),
				"%s's own floorplan passes the realisability gate" % name)
		t.eq(ex.graph.euler_characteristic(), 2, "%s embeds in the plane" % name)
		t.ok(ex.graph.is_one_piece(), "%s is connected" % name)


func test_euler_counts_components() -> void:
	# A graph in two planar pieces scores 4, not 2. Reading that as "non-planar"
	# is what hid the real cause of the stall.
	var ex := DGGExample.from_file("res://examples/cells.json")
	var one := ex.graph
	t.eq(one.euler_characteristic(), 2, "one piece scores 2")
	var two := _disjoint_union(one)
	t.ok(not two.is_one_piece(), "the union is two pieces")
	t.eq(two.euler_characteristic(), 4, "and scores 2 per component")


func test_pairing_laws_hold_in_every_generated_dungeon() -> void:
	# The law the feasibility analysis is built on: in a finished dungeon each edge
	# label's two half-edges appear equally often, because every one is glued.
	var ex := DGGExample.from_file("res://examples/cells.json")
	var grammar := DGGGrammar.from_example(ex)
	grammar.max_generations = 3
	grammar.build()
	var gen := DGGGenerator.new(grammar, 11)
	gen.configure_lengths(ex.min_edge_length, ex.max_edge_length)
	gen.target_vertices = 30
	var dungeon := gen.generate(120)
	t.ok(dungeon != null, "a dungeon was generated")
	var positive := {}
	var negative := {}
	for s in dungeon.spoke_count():
		if dungeon.spoke_partner[s] < 0:
			continue
		var e := DGGLabels.head_edge(dungeon.spoke_head[s])
		if DGGLabels.head_is_positive(dungeon.spoke_head[s]):
			positive[e] = int(positive.get(e, 0)) + 1
		else:
			negative[e] = int(negative.get(e, 0)) + 1
	for e in positive:
		t.eq(negative.get(e, 0), positive[e],
				"edge label %d pairs up exactly" % e)


func test_feasibility_finds_the_invariants_that_hold() -> void:
	var ex := DGGExample.from_file("res://examples/cells.json")
	var f := DGGFeasibility.analyse(ex)
	t.ok(f.cone_dimension > 0, "the usage cone is non-empty")
	t.ok(f.cone_dimension < ex.primitives.size(),
			"and smaller than the primitive count, so label counts are constrained")
	t.ok(f.invariants.size() > 0, "exact relations between label counts were found")

	# Each reported relation must actually hold on the example itself.
	var counts := _label_counts(ex.graph)
	for relation in f.invariants:
		var sum := 0.0
		for e in relation:
			sum += float(relation[e]) * counts.get(e, 0)
		t.ok(absf(sum) < 1e-6, "a reported invariant holds on the example itself")


func test_feasibility_ratio_bands_contain_the_example() -> void:
	# The example is by definition reachable, so its own label shares must lie
	# inside the reported bands. A band that excluded them would be telling users
	# their own floorplan is impossible.
	for name in ["cells", "vaults", "warren"]:
		var ex := DGGExample.from_file("res://examples/%s.json" % name)
		var f := DGGFeasibility.analyse(ex)
		if f.ratio_range.is_empty():
			continue
		var counts := _label_counts(ex.graph)
		var total := 0.0
		for e in counts:
			total += counts[e]
		for e in f.ratio_range.size():
			var share: float = float(counts.get(e, 0)) / maxf(total, 1.0)
			t.ok(f.ratio_is_reachable(e, share),
					"%s: label %d's own share %.3f is inside its band" % [name, e, share])


func _label_counts(g: DGGGraph) -> Dictionary:
	var counts := {}
	for s in g.spoke_count():
		if g.spoke_partner[s] >= 0 and DGGLabels.head_is_positive(g.spoke_head[s]):
			var e := DGGLabels.head_edge(g.spoke_head[s])
			counts[e] = int(counts.get(e, 0)) + 1
	return counts


func _area(g: DGGGraph, verts: PackedInt32Array) -> float:
	var a := 0.0
	for i in verts.size():
		var p := g.vertex_pos[verts[i]]
		var q := g.vertex_pos[verts[(i + 1) % verts.size()]]
		a += p.x * q.y - q.x * p.y
	return a * 0.5


## Two copies of a graph side by side, as one DGGGraph with two components.
func _disjoint_union(g: DGGGraph) -> DGGGraph:
	var out := g.duplicate_graph()
	var v_off := g.vertex_count
	var s_off := g.spoke_count()
	out.vertex_count += g.vertex_count
	for s in g.spoke_count():
		out.spoke_vertex.append(g.spoke_vertex[s] + v_off)
		out.spoke_head.append(g.spoke_head[s])
		out.spoke_partner.append(g.spoke_partner[s] + s_off)
	for ring in g.vertex_spokes:
		var shifted := PackedInt32Array()
		for s in ring:
			shifted.append(s + s_off)
		out.vertex_spokes.append(shifted)
	for p in g.vertex_pos:
		out.vertex_pos.append(p + Vector2(100.0, 0.0))
	return out
