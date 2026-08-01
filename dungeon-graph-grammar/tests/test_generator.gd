extends RefCounted

## End-to-end checks: derive a grammar, generate a dungeon from it, and confirm
## the result is a well-formed plane graph that is locally similar to the example.

var t


func _run(path: String, generations: int, iterations: int, seed: int) -> Dictionary:
	var ex := DGGExample.from_file(path)
	var g := DGGGrammar.from_example(ex)
	g.max_generations = generations
	g.build()
	var gen := DGGGenerator.new(g, seed)
	gen.configure_lengths(ex.min_edge_length, ex.max_edge_length)
	return {"example": ex, "grammar": g, "generator": gen,
			"graph": gen.generate(iterations)}


func test_generation_produces_a_complete_graph() -> void:
	var r := _run("res://examples/cells.json", 3, 80, 12345)
	var graph: DGGGraph = r["graph"]
	t.ok(graph != null, "generation returns a dungeon")
	t.ok(graph.is_complete(), "with nothing left to glue")
	for p in graph.spoke_partner:
		t.ok(p >= 0, "every spoke is paired into a full edge")


func test_generated_geometry_obeys_the_labels() -> void:
	var r := _run("res://examples/cells.json", 3, 80, 999)
	var graph: DGGGraph = r["graph"]
	var ex: DGGExample = r["example"]
	var checked := 0
	var seen := {}
	for s in graph.spoke_count():
		var p: int = graph.spoke_partner[s]
		if p < 0 or seen.has(s):
			continue
		seen[s] = true
		seen[p] = true
		var a: Vector2 = graph.vertex_pos[graph.spoke_vertex[s]]
		var b: Vector2 = graph.vertex_pos[graph.spoke_vertex[p]]
		var length := a.distance_to(b)
		t.ok(length >= ex.min_edge_length - 0.01 and length <= ex.max_edge_length + 0.01,
				"edge length %.2f is inside the author's range" % length)
		# The drawn direction must match the angle the label carries, or the shape
		# has stopped being locally similar.
		var want: float = ex.labels.head_direction(graph.spoke_head[s])
		var got := rad_to_deg((b - a).angle())
		var delta := absf(DGGLabels.normalize_180(got - want))
		t.ok(delta < 0.5, "edge points along its label's angle (off by %.2f°)" % delta)
		checked += 1
	t.ok(checked > 0, "there were edges to check")


func test_generated_vertices_are_example_primitives() -> void:
	# Local similarity, checked on the output: every corner of the generated
	# dungeon is a corner that appears somewhere in the example.
	var r := _run("res://examples/cells.json", 3, 80, 7)
	var graph: DGGGraph = r["graph"]
	var ex: DGGExample = r["example"]
	var allowed := {}
	for prim in ex.primitives:
		allowed[prim.canonical_key()] = true
	for v in graph.vertex_count:
		var heads: Array = []
		for s in graph.vertex_spokes[v]:
			heads.append(graph.spoke_head[s])
		var star := DGGGraph.from_vertex(ex.labels, heads)
		t.ok(allowed.has(star.canonical_key()),
				"vertex %d of the output is a primitive of the example" % v)


func test_different_seeds_diverge() -> void:
	var a := _run("res://examples/cells.json", 3, 120, 1)
	var b := _run("res://examples/cells.json", 3, 120, 2)
	var ga: DGGGraph = a["graph"]
	var gb: DGGGraph = b["graph"]
	t.ok(ga != null and gb != null, "both seeds generate")
	var gen_a: DGGGenerator = a["generator"]
	t.ok(gen_a.accepted > 0, "at least some proposals were accepted")
	t.ok(ga.canonical_key() != gb.canonical_key() or ga.vertex_count != gb.vertex_count,
			"different seeds explore different shapes")


func test_output_is_planar() -> void:
	var r := _run("res://examples/cells.json", 3, 80, 4242)
	var graph: DGGGraph = r["graph"]
	var segments: Array = []
	var seen := {}
	for s in graph.spoke_count():
		var p: int = graph.spoke_partner[s]
		if p < 0 or seen.has(s):
			continue
		seen[s] = true
		seen[p] = true
		segments.append([graph.spoke_vertex[s], graph.spoke_vertex[p]])
	for i in segments.size():
		for j in range(i + 1, segments.size()):
			var u: Array = segments[i]
			var w: Array = segments[j]
			if u[0] == w[0] or u[0] == w[1] or u[1] == w[0] or u[1] == w[1]:
				continue
			var hit = Geometry2D.segment_intersects_segment(
					graph.vertex_pos[u[0]], graph.vertex_pos[u[1]],
					graph.vertex_pos[w[0]], graph.vertex_pos[w[1]])
			t.ok(hit == null, "no two walls cross")
