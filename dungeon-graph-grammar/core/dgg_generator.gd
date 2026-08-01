@tool
class_name DGGGenerator
extends RefCounted

## Generates dungeons by walking the space of locally similar shapes (§6).
##
## Start from the empty graph, fire a starter rule to get some complete shape on
## the table, then keep rewriting. DPO rules run in both directions, so each step
## either builds the graph up (apply a rule backwards, [code]R → L[/code]) or takes
## it back down ([code]L → R[/code]); the walk wanders rather than growing
## monotonically, which is what stops the output from being a scaled-up copy of the
## example.
##
## Every intermediate graph is complete — there is never a half-edge left dangling —
## so the run can be stopped at any iteration and the result is a valid dungeon.
## Applying a rule is two steps: find where the source side sits inside the current
## graph, then unpick it and stitch the other side into the same sockets. Because
## both sides of a rule share a boundary string, the sockets always line up.
##
## Geometry is settled per step by [DGGLayout]. A step whose drawing cannot be
## solved is discarded and the graph is left as it was.

signal step_applied(iteration: int, rule: DGGRule, backwards: bool)

## Packing base for (piece, position) pairs while stitching a rule's seam.
const SEAM_STRIDE := 4096

var grammar: DGGGrammar
var layout: DGGLayout
var rng: RandomNumberGenerator
## Skip starter rules once the dungeon exists, so the output stays one piece.
var keep_connected: bool = true
## Attempts to find a placement for a rule's source side before giving up on it.
var match_attempts: int = 24
## Ceiling on placements enumerated for one rule application.
var max_placements: int = 40
## Rules to try per iteration. Most rules do not apply to most graphs, so drawing
## a few candidates before conceding the iteration keeps the walk moving.
var proposals_per_iteration: int = 8
## Rough vertex count to steer towards. Zero leaves the walk unbiased, which
## wanders around whatever size the starting shape happened to be.
var target_vertices: int = 0
## How readily the walk accepts a step away from [member target_vertices]. Larger
## values wander more.
var temperature: float = 2.0

var accepted: int = 0
var rejected: int = 0
## Proposals thrown out because the rule's source side was nowhere in the graph.
var unmatched: int = 0
## Proposals whose splice produced a rotation system that does not embed in the
## plane, so no drawing of it could exist.
var nonplanar: int = 0
## Proposals thrown out because no valid drawing could be found for them.
var undrawable: int = 0
## Tally of [member DGGLayout.last_failure] strings, for diagnosing an example
## whose edge-length range or angles make most rewrites undrawable.
var failure_reasons: Dictionary = {}


func _init(p_grammar: DGGGrammar, seed: int = 0) -> void:
	grammar = p_grammar
	rng = RandomNumberGenerator.new()
	rng.seed = seed
	layout = DGGLayout.new(rng)


func configure_lengths(min_length: float, max_length: float) -> void:
	layout.min_edge_length = min_length
	layout.max_edge_length = max_length


## Runs Algorithm 3 for [param iterations] proposals and returns the drawing.
func generate(iterations: int, start: DGGGraph = null) -> DGGGraph:
	accepted = 0
	rejected = 0
	unmatched = 0
	undrawable = 0
	nonplanar = 0
	failure_reasons = {}
	var current := start.duplicate_graph() if start else _seed_graph()
	if current == null:
		return null
	if not layout.realise(current):
		return null

	var applicable := grammar.rules.filter(func(r): return not r.is_starter())
	if applicable.is_empty():
		return current
	for i in iterations:
		var proposal: DGGGraph = null
		var chosen: DGGRule = null
		var chosen_backwards := false
		for tries in proposals_per_iteration:
			var rule: DGGRule = applicable[rng.randi() % applicable.size()]
			var backwards := rng.randi() % 2 == 0
			var candidate := _apply(current, rule, backwards)
			if candidate == null:
				continue
			if not layout.realise(candidate):
				undrawable += 1
				var why := layout.last_failure
				failure_reasons[why] = int(failure_reasons.get(why, 0)) + 1
				continue
			proposal = candidate
			chosen = rule
			chosen_backwards = backwards
			break
		if proposal == null or not _accept(current, proposal):
			rejected += 1
			continue
		current = proposal
		accepted += 1
		step_applied.emit(i, chosen, chosen_backwards)
	return current


## The optional Metropolis filter of §6.3, requirement 4.
##
## Without a target the walk is unbiased and drifts nowhere in particular; with
## one, steps towards the requested size are always taken and steps away are taken
## with a falling probability. The cost function is arbitrary in the paper — size
## is simply the knob a dungeon needs most.
func _accept(current: DGGGraph, proposal: DGGGraph) -> bool:
	if target_vertices <= 0:
		return true
	var before := absi(current.vertex_count - target_vertices)
	var after := absi(proposal.vertex_count - target_vertices)
	if after <= before:
		return true
	return rng.randf() < exp(-float(after - before) / maxf(temperature, 0.01))


## The starting shape: whichever complete graph a starter rule offers, preferring
## one that already carries the example's coordinates.
func _seed_graph() -> DGGGraph:
	var starters := grammar.rules.filter(func(r): return r.is_starter())
	if starters.is_empty():
		return null
	for r in starters:
		if not r.left.vertex_pos.is_empty():
			return r.left.duplicate_graph()
	var pick: DGGRule = starters[rng.randi() % starters.size()]
	var g := pick.left.duplicate_graph()
	g.vertex_pos.resize(g.vertex_count)
	g.vertex_pos.fill(DGGLayout.NO_POSITION)
	return g


# --- Rule application ---------------------------------------------------------

## Rewrites [param graph] with one rule. [param backwards] applies
## [code]R → L[/code], which grows the graph; otherwise [code]L → R[/code].
## Returns null when the source side cannot be placed.
func _apply(graph: DGGGraph, rule: DGGRule, backwards: bool) -> DGGGraph:
	var source: Array[DGGGraph] = []
	var target: Array[DGGGraph] = []
	if backwards:
		source.assign(rule.right)
		target.append(rule.left)
	else:
		source.append(rule.left)
		target.assign(rule.right)
	if source.is_empty():
		return null  # starter rules are handled by _seed_graph
	if keep_connected and target.is_empty():
		return null

	# Where the pieces sit matters. A rule promises its two sides share a boundary,
	# but a multi-piece side can be found in the host in arrangements the rule never
	# meant — nested the wrong way round, or on opposite sides of a corridor — and
	# splicing those produces a graph that does not embed in the plane at all.
	# Rather than guess, enumerate the placements and take the first that works.
	var placements := _all_placements(graph, source)
	if placements.is_empty():
		unmatched += 1
		return null
	for matches in placements:
		var result := _attempt(graph, rule, backwards, source, target, matches)
		if result != null:
			return result
	return null


## One placement of the source side, swapped for the target side.
func _attempt(graph: DGGGraph, rule: DGGRule, backwards: bool,
		source: Array[DGGGraph], target: Array[DGGGraph], matches: Array) -> DGGGraph:

	# Walk the shared boundary. Position i of ∂L names a spoke on each side; the
	# source's spoke leads, through the graph, to the socket the target must take
	# over.
	var n := rule.left.boundary.size()
	var host_spokes := PackedInt32Array()
	var target_spokes := PackedInt32Array()
	host_spokes.resize(n)
	target_spokes.resize(n)
	for i in n:
		var pair: Vector2i = rule.seam[i]
		var src_piece := 0 if not backwards else pair.x
		var src_pos := i if not backwards else pair.y
		var tgt_piece := pair.x if not backwards else 0
		var tgt_pos := pair.y if not backwards else i
		var pattern: DGGGraph = source[src_piece]
		var smap: PackedInt32Array = matches[src_piece]["spokes"]
		host_spokes[i] = smap[pattern.boundary_spokes[src_pos]]
		target_spokes[i] = tgt_piece * SEAM_STRIDE + tgt_pos

	# Most boundary positions lead out to a socket on a vertex that survives. Some
	# lead straight back into the cut region — the source side is adjacent to
	# itself across the cut, which happens constantly in a dense floorplan. Those
	# two ends simply join to each other instead of to a socket. Treating that as
	# a failure would make most rules inapplicable to anything but a sparse graph.
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
			return null
		sockets[i] = socket
		if removed.has(graph.spoke_vertex[socket]):
			var j := Array(host_spokes).find(socket)
			if j < 0:
				return null  # cut edge with no counterpart on the boundary
			self_pair[i] = j

	var result := _splice(graph, removed, target, sockets, self_pair, target_spokes)
	if result == null:
		return null
	# Euler's formula settles whether the arrangement was the one the rule assumed.
	if not result.is_one_piece() or result.euler_characteristic() != 2:
		nonplanar += 1
		return null
	return result


## Rebuilds the graph with [param removed] vertices gone and [param inserted]
## graphs put in their place, reconnecting through the recorded sockets.
func _splice(graph: DGGGraph, removed: Dictionary, inserted: Array[DGGGraph],
		sockets: PackedInt32Array, self_pair: PackedInt32Array,
		packed_targets: PackedInt32Array) -> DGGGraph:
	var out := DGGGraph.new()
	out.labels = graph.labels
	out.boundary = DGGBoundary.complete()

	var vmap := PackedInt32Array()
	vmap.resize(graph.vertex_count)
	vmap.fill(-1)
	var smap := PackedInt32Array()
	smap.resize(graph.spoke_count())
	smap.fill(-1)

	for v in graph.vertex_count:
		if removed.has(v):
			continue
		vmap[v] = out.vertex_count
		out.vertex_count += 1
		out.vertex_pos.append(graph.vertex_pos[v])
		var ring := PackedInt32Array()
		for s in graph.vertex_spokes[v]:
			smap[s] = out.spoke_vertex.size()
			out.spoke_vertex.append(vmap[v])
			out.spoke_head.append(graph.spoke_head[s])
			out.spoke_partner.append(-1)
			ring.append(smap[s])
		out.vertex_spokes.append(ring)
	for v in graph.vertex_count:
		if removed.has(v):
			continue
		for s in graph.vertex_spokes[v]:
			var p: int = graph.spoke_partner[s]
			if p >= 0 and smap[p] >= 0:
				out.spoke_partner[smap[s]] = smap[p]

	# Drop the replacement pieces in, unplaced; the layout stage will site them.
	var piece_spoke_base: Array[int] = []
	for piece in inserted:
		piece_spoke_base.append(out.spoke_vertex.size())
		var v_off := out.vertex_count
		for v in piece.vertex_count:
			out.vertex_pos.append(DGGLayout.NO_POSITION)
		out.vertex_count += piece.vertex_count
		var base := out.spoke_vertex.size()
		for s in piece.spoke_count():
			out.spoke_vertex.append(piece.spoke_vertex[s] + v_off)
			out.spoke_head.append(piece.spoke_head[s])
			out.spoke_partner.append(-1)
		for ring in piece.vertex_spokes:
			var shifted := PackedInt32Array()
			for s in ring:
				shifted.append(s + base)
			out.vertex_spokes.append(shifted)
		for s in piece.spoke_count():
			var p: int = piece.spoke_partner[s]
			if p >= 0:
				out.spoke_partner[s + base] = p + base

	for i in sockets.size():
		var spoke := _inserted_spoke(inserted, piece_spoke_base, packed_targets[i])
		var j: int = self_pair[i]
		if j >= 0:
			if j < i:
				continue  # already joined from the other end
			var mate := _inserted_spoke(inserted, piece_spoke_base, packed_targets[j])
			if not DGGBoundary.are_complementary(out.spoke_head[spoke], out.spoke_head[mate]):
				return null
			out.spoke_partner[spoke] = mate
			out.spoke_partner[mate] = spoke
			continue
		var socket := smap[sockets[i]]
		if socket < 0:
			return null
		if not DGGBoundary.are_complementary(out.spoke_head[socket], out.spoke_head[spoke]):
			return null
		out.spoke_partner[socket] = spoke
		out.spoke_partner[spoke] = socket

	for p in out.spoke_partner:
		if p < 0:
			return null  # a half-edge escaped; the rewrite would not be complete
	return out


static func _inserted_spoke(inserted: Array[DGGGraph], bases: Array[int], packed: int) -> int:
	var piece: int = packed / SEAM_STRIDE
	var pos: int = packed % SEAM_STRIDE
	return bases[piece] + inserted[piece].boundary_spokes[pos]


# --- Matching -----------------------------------------------------------------

## Enumerates ways of placing every component of a rule's source side inside the
## graph, vertex-disjoint.
##
## Placements are shuffled and capped: for a multi-piece side the number of
## combinations grows fast, and only a handful will turn out to be arranged the
## way the rule assumes, so it is cheaper to look at a random sample of them than
## to be exhaustive.
func _all_placements(graph: DGGGraph, patterns: Array[DGGGraph]) -> Array:
	var out: Array = []
	_collect(graph, patterns, 0, {}, [], out)
	return out


func _collect(graph: DGGGraph, patterns: Array[DGGGraph], depth: int,
		used: Dictionary, acc: Array, out: Array) -> void:
	if out.size() >= max_placements:
		return
	if depth == patterns.size():
		out.append(acc.duplicate())
		return
	var pattern: DGGGraph = patterns[depth]
	if pattern.spoke_count() == 0:
		return
	var wanted: int = pattern.spoke_head[0]
	var seeds: Array[int] = []
	for s in graph.spoke_count():
		if graph.spoke_head[s] == wanted and not used.has(graph.spoke_vertex[s]):
			seeds.append(s)
	_shuffle(seeds)
	for seed in seeds:
		if out.size() >= max_placements:
			return
		var m := _try_match(graph, pattern, seed, used)
		if m.is_empty():
			continue
		var vertices: PackedInt32Array = m["vertices"]
		for v in vertices:
			used[v] = true
		acc.append(m)
		_collect(graph, patterns, depth + 1, used, acc, out)
		acc.pop_back()
		for v in vertices:
			used.erase(v)


func _shuffle(items: Array[int]) -> void:
	for i in range(items.size() - 1, 0, -1):
		var j := rng.randi() % (i + 1)
		var tmp: int = items[i]
		items[i] = items[j]
		items[j] = tmp


## Grows a correspondence outwards from one spoke pair.
##
## A matched vertex must have the [i]same[/i] spokes in the same cyclic order as
## its counterpart, not merely a superset: cutting an edge leaves both halves
## behind, so a pattern vertex always carries every spoke its host does. That makes
## the walk deterministic once the seed pair is chosen.
func _try_match(graph: DGGGraph, pattern: DGGGraph, seed_spoke: int, used: Dictionary) -> Dictionary:
	var vmap := PackedInt32Array()
	vmap.resize(pattern.vertex_count)
	vmap.fill(-1)
	var smap := PackedInt32Array()
	smap.resize(pattern.spoke_count())
	smap.fill(-1)
	var taken := {}
	var queue: Array[Vector2i] = [Vector2i(0, seed_spoke)]
	var qi := 0
	while qi < queue.size():
		var pair: Vector2i = queue[qi]
		qi += 1
		var ps := pair.x
		var hs := pair.y
		var pv: int = pattern.spoke_vertex[ps]
		var hv: int = graph.spoke_vertex[hs]
		if vmap[pv] >= 0:
			if vmap[pv] != hv or smap[ps] != hs:
				return {}
			continue
		if used.has(hv) or taken.has(hv):
			return {}
		var pring: PackedInt32Array = pattern.vertex_spokes[pv]
		var hring: PackedInt32Array = graph.vertex_spokes[hv]
		var deg := pring.size()
		if hring.size() != deg:
			return {}
		var pbase := pring.find(ps)
		var hbase := hring.find(hs)
		for t in deg:
			var p_spoke: int = pring[(pbase + t) % deg]
			var h_spoke: int = hring[(hbase + t) % deg]
			if pattern.spoke_head[p_spoke] != graph.spoke_head[h_spoke]:
				return {}
		vmap[pv] = hv
		taken[hv] = true
		for t in deg:
			var p_spoke: int = pring[(pbase + t) % deg]
			var h_spoke: int = hring[(hbase + t) % deg]
			smap[p_spoke] = h_spoke
			var pp: int = pattern.spoke_partner[p_spoke]
			if pp >= 0:
				var hp: int = graph.spoke_partner[h_spoke]
				if hp < 0:
					return {}
				queue.append(Vector2i(pp, hp))
	for v in vmap:
		if v < 0:
			return {}
	var vertices := PackedInt32Array()
	for v in vmap:
		vertices.append(v)
	return {"vertices": vertices, "spokes": smap}
