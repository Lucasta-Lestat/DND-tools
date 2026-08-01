extends RefCounted

## Checks the invariants every derived rule must satisfy. These are the guarantees
## that make a rule safe to apply: get them wrong and the generator silently
## produces graphs that are not locally similar to the example.

var t


func _grammar(path: String, generations: int) -> DGGGrammar:
	var ex := DGGExample.from_file(path)
	var g := DGGGrammar.from_example(ex)
	g.max_generations = generations
	g.build()
	return g


func test_grammar_is_derived_without_hand_written_rules() -> void:
	var g := _grammar("res://examples/cells.json", 2)
	t.ok(g.rules.size() > 0, "rules are found automatically")
	t.ok(g.primitives.size() > 0, "from primitives alone")
	var starters := g.rules.filter(func(r): return r.is_starter())
	t.ok(starters.size() >= 1, "at least one starter rule to begin a derivation")


func test_every_rule_preserves_the_boundary_string() -> void:
	# The core soundness property (§5.3): a rule may only swap two things that
	# present the same half-edges, in the same cyclic order, with the same total
	# curvature. Otherwise the replacement would break planarity.
	var g := _grammar("res://examples/cells.json", 3)
	for rule in g.rules:
		if rule.is_starter():
			t.ok(rule.left.is_complete(), "a starter rule's left side is a whole shape")
			continue
		var n: int = rule.left.boundary.size()
		t.eq(rule.seam.size(), n, "the seam covers every half-edge of ∂L")
		var covered := {}
		for i in n:
			var pair: Vector2i = rule.seam[i]
			t.ok(pair.x >= 0 and pair.x < rule.right.size(), "seam names a real piece")
			var piece: DGGGraph = rule.right[pair.x]
			t.ok(pair.y >= 0 and pair.y < piece.boundary.size(), "and a real position")
			t.eq(piece.boundary.heads[pair.y], rule.left.boundary.heads[i],
					"the half-edge labels agree across the rule")
			covered["%d:%d" % [pair.x, pair.y]] = true
		var total := 0
		for piece in rule.right:
			total += piece.boundary.size()
		t.eq(covered.size(), total, "the seam is a bijection onto the right-hand sides")
		t.eq(total, n, "so both sides carry exactly the same half-edges")


func test_rules_only_reduce_to_simpler_graphs() -> void:
	# §5.1: the right-hand side is always simpler, measured in half-edges. This is
	# what makes reduction terminate and, run backwards, what makes generation
	# build rather than churn.
	var g := _grammar("res://examples/cells.json", 3)
	for rule in g.rules:
		if rule.is_starter():
			continue
		for piece in rule.right:
			t.ok(piece.boundary.size() <= rule.left.boundary.size(),
					"a piece never has more half-edges than the graph it replaces")


func test_no_degenerate_edges_reach_the_grammar() -> void:
	# Self-loops and doubled edges are legal cyclic words but have no straight-line
	# drawing, so they are pruned while gluing rather than at drawing time.
	var g := _grammar("res://examples/cells.json", 3)
	for graph in g.hierarchy:
		for s in graph.spoke_count():
			var p: int = graph.spoke_partner[s]
			if p < 0:
				continue
			t.ok(graph.spoke_vertex[s] != graph.spoke_vertex[p], "no self-loops")


func test_hierarchy_is_deduplicated() -> void:
	var g := _grammar("res://examples/cells.json", 3)
	var keys := {}
	for graph in g.hierarchy:
		var k := graph.canonical_key()
		t.ok(not keys.has(k), "each graph appears in the hierarchy once")
		keys[k] = true


func test_every_hierarchy_graph_is_locally_similar() -> void:
	# Everything in the hierarchy is glued from the example's primitives, so every
	# vertex of every graph must be one of those primitives — that is local
	# similarity, in its strongest form.
	var g := _grammar("res://examples/cells.json", 2)
	var allowed := {}
	for prim in g.primitives:
		allowed[prim.canonical_key()] = true
	for graph in g.hierarchy:
		for v in graph.vertex_count:
			var heads: Array = []
			for s in graph.vertex_spokes[v]:
				heads.append(graph.spoke_head[s])
			var star := DGGGraph.from_vertex(g.labels, heads)
			t.ok(allowed.has(star.canonical_key()),
					"vertex %d of a hierarchy graph is an example primitive" % v)
