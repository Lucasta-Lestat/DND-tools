extends SceneTree

## What could a perfect generator ever do with this grammar?
##
##     godot --headless --path . --script res://tools/ceiling.gd -- vaults 3
##
## The generator samples placements, so a stalled run leaves it ambiguous whether
## the search is unlucky or the space is empty. This enumerates EVERY placement of
## every rule in both directions against the example graph, with no sampling cap,
## and classifies each one. If the ceiling is zero, no amount of cleverness in the
## placement search will help and the problem is upstream in rule discovery.


class Enumerator extends DGGGenerator:
	var tally: Dictionary = {}
	var wins: Array = []

	func _init(g: DGGGrammar, s: int) -> void:
		super(g, s)

	func _bump(key: String) -> void:
		tally[key] = int(tally.get(key, 0)) + 1

	## Mirrors DGGGenerator._attempt but records why each placement was rejected
	## instead of collapsing everything into one counter.
	func _attempt(graph: DGGGraph, rule: DGGRule, backwards: bool,
			source: Array[DGGGraph], target: Array[DGGGraph], matches: Array) -> DGGGraph:
		var dir := "R->L grow  " if backwards else "L->R shrink"
		var n := rule.left.boundary.size()
		var host_spokes := PackedInt32Array()
		var target_spokes := PackedInt32Array()
		host_spokes.resize(n)
		target_spokes.resize(n)
		for i in n:
			var pair: Vector2i = rule.seam[i]
			var pattern: DGGGraph = source[0 if not backwards else pair.x]
			var smap: PackedInt32Array = matches[0 if not backwards else pair.x]["spokes"]
			host_spokes[i] = smap[pattern.boundary_spokes[i if not backwards else pair.y]]
			target_spokes[i] = (pair.x if not backwards else 0) * DGGGenerator.SEAM_STRIDE \
					+ (pair.y if not backwards else i)
		var sockets := PackedInt32Array()
		var self_pair := PackedInt32Array()
		sockets.resize(n)
		self_pair.resize(n)
		self_pair.fill(-1)
		var removed := {}
		for m in matches:
			for v in (m["vertices"] as PackedInt32Array):
				removed[v] = true
		for i in n:
			var socket: int = graph.spoke_partner[host_spokes[i]]
			if socket < 0:
				_bump("%s  1 no socket" % dir)
				return null
			sockets[i] = socket
			if removed.has(graph.spoke_vertex[socket]):
				var j := Array(host_spokes).find(socket)
				if j < 0:
					_bump("%s  1 no socket" % dir)
					return null
				self_pair[i] = j
		var result := _splice(graph, removed, target, sockets, self_pair, target_spokes)
		if result == null:
			_bump("%s  2 splice failed" % dir)
			return null
		if not result.is_one_piece():
			_bump("%s  3 disconnected" % dir)
			return null
		if result.euler_characteristic() != 2:
			_bump("%s  4 not planar" % dir)
			return null
		if not result.faces_are_realisable():
			_bump("%s  5 face cannot be drawn at these angles" % dir)
			return null
		_bump("%s  6 USABLE" % dir)
		wins.append({"rule": rule.describe(), "dir": dir, "graph": result.duplicate_graph()})
		return result


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	var name: String = "cells" if args.is_empty() else args[0]
	var generations: int = 3 if args.size() < 2 else int(args[1])
	var example := DGGExample.from_file("res://examples/%s.json" % name)
	var grammar := DGGGrammar.from_example(example)
	grammar.max_generations = generations
	var t0 := Time.get_ticks_msec()
	grammar.build()
	print("=== %s, generations %d ===" % [name, generations])
	print("%s\n  built in %d ms" % [grammar.summary(), Time.get_ticks_msec() - t0])

	var host: DGGGraph = null
	for r in grammar.rules:
		if r.is_starter() and not r.left.vertex_pos.is_empty():
			host = r.left.duplicate_graph()
			break
	if host == null:
		printerr("no starter rule carries the example's coordinates")
		quit(1)
		return

	var gen := Enumerator.new(grammar, 5)
	gen.configure_lengths(example.min_edge_length, example.max_edge_length)
	gen.max_placements = 1000000  # exhaustive: never truncate
	var placements := 0
	for rule in grammar.rules:
		if rule.is_starter():
			continue
		for backwards in [false, true]:
			var source: Array[DGGGraph] = []
			var target: Array[DGGGraph] = []
			if backwards:
				source.assign(rule.right)
				target.append(rule.left)
			else:
				source.append(rule.left)
				target.assign(rule.right)
			var all := gen._all_placements(host, source)
			placements += all.size()
			for m in all:
				gen._attempt(host, rule, backwards, source, target, m)

	print("  %d placements exist in total across every rule and direction" % placements)
	var keys := gen.tally.keys()
	keys.sort()
	for k in keys:
		print("    %6d  %s" % [gen.tally[k], k])

	var layout := DGGLayout.new(RandomNumberGenerator.new())
	layout.rng.seed = 77
	layout.min_edge_length = example.min_edge_length
	layout.max_edge_length = example.max_edge_length
	var drawn := 0
	var why := {}
	for w in gen.wins:
		if layout.realise((w["graph"] as DGGGraph).duplicate_graph()):
			drawn += 1
		else:
			why[layout.last_failure] = int(why.get(layout.last_failure, 0)) + 1
	print("  CEILING: %d of %d usable placements actually draw%s" % [
		drawn, gen.wins.size(), "" if why.is_empty() else "   (%s)" % str(why)])
	var distinct := {}
	for w in gen.wins:
		distinct["%s  %s" % [w["dir"], w["rule"]]] = true
	for k in distinct:
		print("    move: %s" % k)
	quit(0)
