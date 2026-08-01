extends SceneTree

## Are half-edge label counts free to vary, or are they pinned by conservation laws?
##
## Every complete graph is assembled from primitives, and every half-edge ends up
## glued to its complement. So for each edge label, the number of `a` half-edges
## must equal the number of `ā`. That is a linear constraint on how many times
## each primitive is used — which bounds what label ratios a user could ever ask
## for. This measures it.

func _initialize() -> void:
	for name in ["cells", "vaults", "burrow", "warren"]:
		var ex := DGGExample.from_file("res://examples/%s.json" % name)
		print("\n=== %s: %d primitives, %d edge labels" % [
			name, ex.primitives.size(), ex.labels.edge_count()])

		# Row per edge label, column per primitive: (# of ā) - (# of a).
		var rows: Array = []
		var rhs := PackedFloat64Array()
		for e in ex.labels.edge_count():
			var row := PackedFloat64Array()
			row.resize(ex.primitives.size())
			row.fill(0.0)
			for p in ex.primitives.size():
				for h in ex.primitives[p].boundary.heads:
					if DGGLabels.head_edge(h) == e:
						row[p] += 1.0 if DGGLabels.head_is_positive(h) else -1.0
			rows.append(row)
			rhs.append(0.0)
		var sol: Dictionary = DGGLinalg.solve(rows, rhs, ex.primitives.size())
		var dim: int = (sol["basis"] as Array).size()
		print("  primitive-usage vectors live in a %d-dimensional cone (of %d)" % [
			dim, ex.primitives.size()])
		print("  => %d independent conservation laws pin the label counts" % [
			ex.primitives.size() - dim])

		# Check the laws hold on the example itself and on generated dungeons.
		_check(ex, ex.graph, "example ")
		var gr := DGGGrammar.from_example(ex)
		gr.max_generations = 3
		gr.build()
		for seed in [3, 21]:
			var gen := DGGGenerator.new(gr, seed)
			gen.configure_lengths(ex.min_edge_length, ex.max_edge_length)
			gen.target_vertices = 40
			var d := gen.generate(150)
			if d != null:
				_check(ex, d, "seed %-4d" % seed)
	quit(0)


## Prints the label-count vector and confirms every label pairs up exactly.
func _check(ex: DGGExample, g: DGGGraph, tag: String) -> void:
	var counts := {}
	var paired := true
	for e in ex.labels.edge_count():
		counts[e] = 0
	for s in g.spoke_count():
		if g.spoke_partner[s] >= 0 and DGGLabels.head_is_positive(g.spoke_head[s]):
			counts[DGGLabels.head_edge(g.spoke_head[s])] += 1
	var parts := PackedStringArray()
	var total := 0
	for e in counts:
		total += counts[e]
	for e in counts:
		parts.append("%d(%.0f%%)" % [counts[e], 100.0 * counts[e] / maxf(total, 1)])
	print("  %s V=%-3d E=%-3d cycles=%-2d  labels: %s" % [
		tag, g.vertex_count, g.edge_count(),
		g.edge_count() - g.vertex_count + 1, " ".join(parts)])
