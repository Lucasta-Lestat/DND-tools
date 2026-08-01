extends RefCounted

## Doorways, anchored rooms, and goal-directed generation.

var t


func test_doorways_become_their_own_label() -> void:
	# A doorway is a wall segment with a different kind, so it is a different label
	# — which is what stops the matcher swapping a door for a solid wall.
	var ex := DGGExample.from_file("res://examples/lair.json")
	t.eq(Array(ex.warnings), [], "lair tiles cleanly")
	t.eq(ex.door_count(), 4, "four doorways were marked")
	var passable := 0
	var solid := 0
	for e in ex.labels.edge_count():
		if ex.labels.edge_is_passable(e):
			passable += 1
		else:
			solid += 1
	t.ok(passable > 0, "some labels are passable")
	t.ok(solid > 0, "and some are not")
	# The same faces and angle, differing only in kind, must be distinct labels.
	var cell := ex.labels.face_id("cell")
	var door := ex.labels.kind_id("door")
	var as_wall := ex.labels.edge_id(cell, cell, 90.0, DGGLabels.KIND_WALL)
	var as_door := ex.labels.edge_id(cell, cell, 90.0, door)
	t.ok(as_wall != as_door, "a doorway is not interchangeable with a wall")


func test_doorway_splits_the_wall_it_sits_in() -> void:
	# The author gives a doorway as a stretch of wall; the loader has to cut the
	# wall at its ends without being told to.
	var ex := DGGExample.from_dict({
		"name": "pair",
		"outer_face": "rock",
		"rooms": [
			{"label": "cell", "polygon": [[0, 0], [2, 0], [2, 2], [0, 2]]},
			{"label": "cell", "polygon": [[2, 0], [4, 0], [4, 2], [2, 2]]},
		],
		"doors": [{"from": [2, 0.5], "to": [2, 1.5]}],
	})
	t.eq(Array(ex.warnings), [], "the doorway lies on a wall")
	t.eq(ex.door_count(), 1, "one doorway")
	t.eq(ex.graph.vertex_count, 8, "the shared wall gained two corners")


func test_doorway_off_the_wall_is_reported() -> void:
	var ex := DGGExample.from_dict({
		"name": "stray",
		"outer_face": "rock",
		"rooms": [{"label": "cell", "polygon": [[0, 0], [2, 0], [2, 2], [0, 2]]}],
		"doors": [{"from": [9, 9], "to": [9, 10]}],
	})
	t.ok(ex.warnings.size() > 0, "a doorway floating in space is a warning, not a crash")
	t.eq(ex.door_count(), 0, "and it marks nothing")


func test_topology_reads_the_room_graph() -> void:
	var ex := DGGExample.from_file("res://examples/lair.json")
	var topo := DGGTopology.analyse(ex.graph, ex.labels.face_id(ex.outer_face))
	t.eq(topo.room_count, 3, "three cells")
	t.eq(topo.door_count, 2, "two doorways between them")
	t.eq(topo.entrance_count, 2, "two ways in from outside")
	t.eq(topo.region_count, 1, "all connected")
	t.eq(topo.loop_count, 0, "a chain has no loops")
	t.eq(topo.depth, 2, "end to end is two doorways")
	t.eq(topo.dead_end_count, 2, "the two ends")
	t.eq(topo.reachable_count, 3, "every room is reachable from outside")


func test_topology_sees_what_cycle_rank_cannot() -> void:
	# The wall graph's cycle rank equals the bounded-face count, so it says nothing
	# about whether rooms connect. A dungeon with no doorways at all has the same
	# wall-graph cycle rank as one where every room opens into the next.
	var ex := DGGExample.from_file("res://examples/cells.json")
	var wall_cycle_rank := ex.graph.edge_count() - ex.graph.vertex_count + 1
	t.eq(wall_cycle_rank, 2, "two bounded faces")
	var topo := DGGTopology.analyse(ex.graph, ex.labels.face_id(ex.outer_face))
	t.eq(topo.room_count, 2, "two rooms")
	t.eq(topo.door_count, 0, "but no doorways — the rooms are sealed boxes")
	t.eq(topo.region_count, 2, "so they are two unconnected regions")


func test_anchored_rooms_survive_generation() -> void:
	var ex := DGGExample.from_file("res://examples/sanctum.json")
	t.ok(ex.graph.frozen_count() > 0, "the vault's corners are pinned")
	var vault := ex.labels.face_id("vault")
	var before := _corners_touching(ex.graph, vault)
	t.ok(before.size() >= 4, "the vault has corners to preserve")

	var grammar := DGGGrammar.from_example(ex)
	grammar.max_generations = 3
	grammar.build()
	for seed in [3, 7]:
		var gen := DGGGenerator.new(grammar, seed)
		gen.configure(ex)
		gen.target_vertices = 36
		var dungeon := gen.generate(150)
		t.ok(dungeon.vertex_count > ex.graph.vertex_count,
				"seed %d grew the dungeon" % seed)
		var after := _corners_touching(dungeon, vault)
		t.eq(after.size(), before.size(), "seed %d kept the vault's corner count" % seed)
		var moved := false
		for i in before.size():
			if (before[i] as Vector2).distance_to(after[i]) > 1e-4:
				moved = true
		t.ok(not moved, "seed %d left every vault corner exactly where it was" % seed)


func test_rule_delta_predicts_the_actual_change() -> void:
	# Goal-directed proposal picking rests on a rule's effect being fixed. If the
	# prediction and the outcome ever disagree, the bias is steering by noise.
	var ex := DGGExample.from_file("res://examples/lair.json")
	var grammar := DGGGrammar.from_example(ex)
	grammar.max_generations = 3
	grammar.build()
	var gen := DGGGenerator.new(grammar, 5)
	gen.configure(ex)
	var host := ex.graph.duplicate_graph()
	var checked := 0
	for rule in grammar.rules:
		if rule.is_starter() or checked >= 12:
			continue
		for backwards in [false, true]:
			var result := gen._apply(host, rule, backwards)
			if result == null:
				continue
			var delta: Dictionary = rule.delta(backwards)
			t.eq(result.vertex_count - host.vertex_count, int(delta["vertices"]),
					"predicted vertex change matches")
			t.eq(result.edge_count() - host.edge_count(), int(delta["edges"]),
					"predicted edge change matches")
			t.eq(result.passable_edge_count() - host.passable_edge_count(),
					int(delta["doors"]), "predicted doorway change matches")
			checked += 1
			break
	t.ok(checked > 0, "some rules applied")


func test_goals_steer_the_room_graph() -> void:
	var ex := DGGExample.from_file("res://examples/lair.json")
	var grammar := DGGGrammar.from_example(ex)
	grammar.max_generations = 3
	grammar.build()

	var tree := _generate(ex, grammar, 5, func(g: DGGGoals):
		g.target_loops = 0
		g.require_single_region = true
		g.require_all_reachable = true)
	t.eq(tree["loops"], 0, "asking for no loops gives a tree")
	t.eq(tree["regions"], 1, "and one connected region")

	var braid := _generate(ex, grammar, 5, func(g: DGGGoals):
		g.target_loops = 4
		g.require_single_region = true
		g.require_all_reachable = true)
	t.ok(braid["loops"] >= 3, "asking for four loops gives a braid, got %d" % braid["loops"])
	t.ok(braid["loops"] > tree["loops"], "and more loops than the tree run")


func test_hard_requirements_are_never_violated() -> void:
	# Soft targets are allowed to miss. Hard ones are not.
	var ex := DGGExample.from_file("res://examples/lair.json")
	var grammar := DGGGrammar.from_example(ex)
	grammar.max_generations = 3
	grammar.build()
	for seed in [1, 5, 9]:
		var run := _generate(ex, grammar, seed, func(g: DGGGoals):
			g.require_single_region = true
			g.require_all_reachable = true)
		t.eq(run["regions"], 1, "seed %d: every room is mutually reachable" % seed)
		t.eq(run["unreachable"], 0, "seed %d: no room is cut off from outside" % seed)


func _generate(ex: DGGExample, grammar: DGGGrammar, seed: int, setup: Callable) -> Dictionary:
	var gen := DGGGenerator.new(grammar, seed)
	gen.configure(ex)
	gen.target_vertices = 34
	setup.call(gen.goals)
	var dungeon := gen.generate(200)
	var topo := DGGTopology.analyse(dungeon, gen.outer_face)
	return {
		"loops": topo.loop_count,
		"regions": maxi(topo.region_count, 1),
		"rooms": topo.room_count,
		"unreachable": topo.room_count - topo.reachable_count,
	}


func _corners_touching(g: DGGGraph, face: int) -> Array:
	var pts: Array = []
	for v in g.vertex_count:
		for s in g.vertex_spokes[v]:
			var h: int = g.spoke_head[s]
			if g.labels.head_left_face(h) == face or g.labels.head_right_face(h) == face:
				pts.append(g.vertex_pos[v])
				break
	pts.sort_custom(func(a, b): return a.x < b.x or (a.x == b.x and a.y < b.y))
	return pts
