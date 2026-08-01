@tool
class_name DGGGrammar
extends RefCounted

## Derives a graph grammar from an example, with no hand-written rules (§4–§5).
##
## The idea in one paragraph. Cut the example into primitives. Glue primitives
## back together in every possible way and you get the space of all locally
## similar graphs — infinite, so it cannot be stored, but it can be walked
## outwards generation by generation. Each time a new graph appears, ask whether
## its boundary string can be rebuilt out of [i]simpler[/i] graphs already seen. If
## it can, that pairing is a production rule, the graph is [b]reducible[/b], and it
## can be dropped: everything below it in the hierarchy is reducible by the same
## rule. What is left over gets expanded further. Once every complete graph is
## reducible, the rules can deconstruct any locally similar shape down to nothing —
## and since DPO rules run backwards just as well, they can build any of them up
## from nothing.
##
## [b]Termination.[/b] The paper notes (§5.7) that for some inputs the hierarchy
## grows faster than graphs can be reduced. Rather than spin, the search is bounded
## by [member max_generations], [member max_half_edges] and [member max_hierarchy].
## Hitting a bound is not an error; it means the grammar may not reach every
## locally similar shape, which in practice still leaves a very large space.
## [member exhausted] reports whether the search finished on its own terms.

signal progress(stage: String, done: int, total: int)

## Stop expanding after this many rounds of gluing.
var max_generations: int = 5
## Discard graphs whose boundary carries more than this many half-edges. Boundary
## matching is combinatorial in this number, so it is the main cost control.
var max_half_edges: int = 8
## Hard ceiling on stored graphs.
var max_hierarchy: int = 1200
## Ceiling on how deeply a boundary may be split into sub-groups when searching
## for a rule.
var max_split_depth: int = 3
## How many candidate decompositions to weigh before settling for the best so far.
var max_decompositions_examined: int = 8
## Ceiling on starter rules. The simplest complete shapes are kept.
var max_starter_rules: int = 48
## Keep loop glues that produce self-loops or doubled edges. They are legitimate
## as cyclic words but have no straight-line drawing, so they are dropped by
## default rather than left for the drawing stage to reject over and over.
var allow_degenerate_edges: bool = false

var labels: DGGLabels
var primitives: Array[DGGGraph] = []
## Complete graphs the hierarchy starts with. The example itself goes here, which
## guarantees the grammar always has at least one shape to start a derivation from
## even when the search is bounded before it stumbles on a complete graph.
var seeds: Array[DGGGraph] = []
## Every graph kept in the concrete hierarchy, in the order it was added.
var hierarchy: Array[DGGGraph] = []
var rules: Array[DGGRule] = []
## True when the frontier emptied on its own rather than hitting a bound.
var exhausted: bool = false
var stats: Dictionary = {}

var _seen: Dictionary = {}           # canonical key → hierarchy index
var _irreducible: Array[int] = []    # indices still usable on a rule's right-hand side
var _reduced: Dictionary = {}        # index → true
var _head_counts: Array = []         # index → {head: count}
var _complete_keys: Dictionary = {}
var _pool: Array[int] = []           # _irreducible, simplest first
var _pool_dirty: bool = true


static func from_example(example: DGGExample) -> DGGGrammar:
	var g := DGGGrammar.new()
	g.labels = example.labels
	g.primitives = example.primitives.duplicate()
	g.seeds = [example.graph]
	return g


## Runs Algorithm 1.
func build() -> void:
	hierarchy.clear()
	rules.clear()
	_seen.clear()
	_irreducible.clear()
	_reduced.clear()
	_head_counts.clear()
	_complete_keys.clear()
	_pool.clear()
	_pool_dirty = true
	exhausted = false

	var frontier: Array[int] = []
	for seed in seeds:
		var seed_idx := _add(seed)
		if seed_idx >= 0:
			_classify(seed_idx)
	for prim in primitives:
		var idx := _add(prim)
		if idx >= 0:
			frontier.append(idx)
			_irreducible.append(idx)
			_pool_dirty = true

	var generation := 0
	var capped := false
	while not frontier.is_empty() and generation < max_generations:
		generation += 1
		progress.emit("gluing, generation %d" % generation, hierarchy.size(), max_hierarchy)
		var next: Array[int] = []
		for parent_idx in frontier:
			if hierarchy.size() >= max_hierarchy:
				capped = true
				break
			for child in _children(hierarchy[parent_idx]):
				var idx := _add(child)
				if idx < 0:
					continue
				if not _classify(idx):
					next.append(idx)
		# A graph that was irreducible earlier may have become reducible now that
		# simpler graphs — stubs especially — have appeared (§5.5).
		_resweep()
		frontier.clear()
		for i in next:
			if not _reduced.has(i):
				frontier.append(i)
		if capped:
			break
	exhausted = frontier.is_empty() and not capped

	var starters := 0
	var splits := 0
	for r in rules:
		if r.is_starter():
			starters += 1
		elif r.right.size() > 1:
			splits += 1
	stats = {
		"primitives": primitives.size(),
		"hierarchy": hierarchy.size(),
		"rules": rules.size(),
		"starter_rules": starters,
		"splitting_rules": splits,
		"stubs": hierarchy.filter(func(g): return g.boundary.is_stub()).size(),
		"generations": generation,
		"exhausted": exhausted,
	}
	progress.emit("done", hierarchy.size(), hierarchy.size())


# --- Hierarchy ----------------------------------------------------------------

func _add(g: DGGGraph) -> int:
	if g.boundary.size() > max_half_edges:
		return -1
	if hierarchy.size() >= max_hierarchy:
		return -1
	var key := g.canonical_key()
	if _seen.has(key):
		return -1
	var idx := hierarchy.size()
	_seen[key] = idx
	hierarchy.append(g)
	var counts := {}
	for h in g.boundary.heads:
		counts[h] = int(counts.get(h, 0)) + 1
	_head_counts.append(counts)
	return idx


## Every graph one gluing operation away: close a loop within the graph, or branch
## on one more primitive (§4.3).
func _children(g: DGGGraph) -> Array[DGGGraph]:
	var out: Array[DGGGraph] = []
	for site in g.loop_glue_sites():
		if allow_degenerate_edges or not g.loop_glue_is_degenerate(site):
			out.append(g.loop_glued(site))
	var k := g.boundary.size()
	for i in k:
		var want := DGGBoundary.opposite(g.boundary.heads[i])
		for prim in primitives:
			for j in prim.boundary.size():
				if prim.boundary.heads[j] == want:
					out.append(g.branch_glued(prim, i, j))
	return out


## Complexity order (§5.1): fewer half-edges is simpler. The paper breaks ties by
## age; we break them by vertex count first, because that is what lets a rule
## replace a graph with a single equally-bounded but smaller one. Without it the
## only same-boundary candidates are older graphs, so every rule is forced to
## split, and a splitting rule is exactly the kind that fails when applied — it
## disconnects the host going one way and needs a lucky arrangement going the
## other. Lexicographic on (half-edges, vertices, age) is still a strict order, so
## reduction still terminates.
func _simpler(a: int, b: int) -> bool:
	var ka := hierarchy[a].boundary.size()
	var kb := hierarchy[b].boundary.size()
	if ka != kb:
		return ka < kb
	var va := hierarchy[a].vertex_count
	var vb := hierarchy[b].vertex_count
	if va != vb:
		return va < vb
	return a < b


## Decides what to do with a newly added graph. Returns true when the graph needs
## no further expansion.
func _classify(idx: int) -> bool:
	var g := hierarchy[idx]
	if g.is_complete():
		# A complete graph is a whole shape with nothing left to glue. It gets a
		# starter rule so the grammar has somewhere to begin; every other rule then
		# grows or reshapes it from the inside.
		var key := g.canonical_key()
		if not _complete_keys.has(key):
			_complete_keys[key] = true
			var starters := 0
			for r in rules:
				if r.is_starter():
					starters += 1
			if starters < max_starter_rules:
				rules.append(DGGRule.starter(g))
		return true
	if _try_reduce(idx):
		return true
	_irreducible.append(idx)
	_pool_dirty = true
	return false


## Looks for a rule that rewrites [param idx] into simpler graphs. On success the
## graph is marked reducible and withdrawn from the pool of right-hand sides.
func _try_reduce(idx: int) -> bool:
	var g := hierarchy[idx]
	var found := _find_group(g.boundary, idx, 0)
	if found.is_empty():
		return false
	var right: Array[DGGGraph] = []
	var seam: Array[Vector2i] = []
	seam.resize(g.boundary.size())
	for piece in found.size():
		var entry: Dictionary = found[piece]
		right.append(hierarchy[entry["index"]])
		var positions: PackedInt32Array = entry["positions"]
		for q in positions.size():
			seam[positions[q]] = Vector2i(piece, q)
	var rule := DGGRule.make(g, right, seam)
	rule.note = "%d half-edges → %d piece(s)" % [g.boundary.size(), right.size()]
	rules.append(rule)
	_reduced[idx] = true
	_irreducible.erase(idx)
	_pool_dirty = true
	return true


## Retries every graph still on the irreducible list. Cheap enough to run once per
## generation, and it is what makes late-discovered stubs pay off retroactively.
func _resweep() -> void:
	var again := true
	var rounds := 0
	while again and rounds < 4:
		again = false
		rounds += 1
		for idx in _irreducible.duplicate():
			if _reduced.has(idx):
				continue
			if _try_reduce(idx):
				again = true


# --- Rule discovery (Algorithm 2) ---------------------------------------------

## Candidates in the order the rule search should try them: widest boundary first.
##
## Not the same as complexity order. A rule wants the FEWEST pieces it can get
## away with, and a piece that covers more of the target boundary leaves less for
## anything else to fill. Trying the simplest graphs first — which is the order
## complexity gives — finds the maximal shattering every time, and shattering is
## what makes rules unusable.
func _sorted_pool() -> Array[int]:
	if _pool_dirty:
		_pool = _irreducible.duplicate()
		_pool.sort_custom(func(a, b):
			var ka := hierarchy[a].boundary.size()
			var kb := hierarchy[b].boundary.size()
			if ka != kb:
				return ka > kb
			return a < b)
		_pool_dirty = false
	return _pool


## Finds a set of graphs whose boundaries splice together to give [param target].
##
## Splicing two boundaries costs one extra negative turn
## ([code]A|B| → A∨B[/code]), and that single fact collapses the whole search: the
## net turn a piece needs between two of its half-edges must equal the net turn the
## target has accumulated across the same stretch. So a candidate is placed by
## matching its half-edges to a subsequence of the target's, checking turn totals
## as it goes, and each run of half-edges left over becomes a smaller instance of
## the same problem.
##
## Returns an array of [code]{index, positions}[/code] — where each piece sits on
## the target's boundary — or an empty array on failure. [param than] is the
## hierarchy index being reduced; only strictly simpler graphs may be used.
func _find_group(target: DGGBoundary, than: int, depth: int) -> Array:
	if target.size() == 0 or depth > max_split_depth:
		return []
	var n := target.size()
	var want := {}
	for h in target.heads:
		want[h] = int(want.get(h, 0)) + 1

	# Keep looking after the first success: the first decomposition found is not
	# the best one, and how many pieces a rule has decides whether it can ever be
	# applied. A single-piece cover is unbeatable, so stop there.
	var best: Array = []
	var examined := 0
	for cand in _sorted_pool():
		if not _simpler(cand, than):
			continue
		var r: DGGBoundary = hierarchy[cand].boundary
		if r.size() == 0 or r.size() > n:
			continue
		if not _fits(_head_counts[cand], want):
			continue
		if not best.is_empty() and r.size() < n / best.size():
			break  # every remaining candidate is too narrow to do better
		for start in n:
			if target.heads[start] != r.heads[0]:
				continue
			var positions := PackedInt32Array()
			positions.resize(r.size())
			positions[0] = start
			var result := _place(target, r, positions, 1, start, start, cand, than, depth)
			if result.is_empty():
				continue
			if best.is_empty() or result.size() < best.size():
				best = result
				if best.size() == 1:
					return best
			examined += 1
			break  # one placement per candidate is enough to judge it
		if examined >= max_decompositions_examined:
			break
	return best


static func _fits(counts: Dictionary, want: Dictionary) -> bool:
	for h in counts:
		if int(want.get(h, 0)) < int(counts[h]):
			return false
	return true


## Backtracking placement of the candidate's remaining half-edges.
##
## [param cursor] is the unrolled index of the last placed half-edge and
## [param origin] the unrolled index of the first, so the candidate's final turn
## slot is measured back round to [code]origin + n[/code].
func _place(target: DGGBoundary, r: DGGBoundary, positions: PackedInt32Array,
		q: int, cursor: int, origin: int, cand: int, than: int, depth: int) -> Array:
	var n := target.size()
	var limit := origin + n
	if q == r.size():
		if _turn_sum(target, cursor, limit) != r.turns[r.size() - 1]:
			return []
		return _resolve_gaps(target, positions, origin, cand, than, depth)
	var slack := r.size() - q
	for pos in range(cursor + 1, limit - slack + 1):
		if target.heads[pos % n] != r.heads[q]:
			continue
		if _turn_sum(target, cursor, pos) != r.turns[q - 1]:
			continue
		positions[q] = pos % n
		var deeper := _place(target, r, positions, q + 1, pos, origin, cand, than, depth)
		if not deeper.is_empty():
			return deeper
	return []


## Net turn across the unrolled half-open range [code][from, to)[/code].
static func _turn_sum(target: DGGBoundary, from: int, to: int) -> int:
	var n := target.size()
	var sum := 0
	for i in range(from, to):
		sum += target.turns[i % n]
	return sum


## Every run of half-edges the candidate skipped becomes its own matching problem.
## A run is closed into a valid boundary by giving it whatever final turn makes it
## loop once — the paper's [code]∂L_i ∧[/code] on line 5 of Algorithm 2.
func _resolve_gaps(target: DGGBoundary, positions: PackedInt32Array,
		origin: int, cand: int, than: int, depth: int) -> Array:
	var n := target.size()
	var out: Array = [{"index": cand, "positions": positions.duplicate()}]
	var unrolled := PackedInt32Array()
	for q in positions.size():
		var p: int = positions[q]
		while p < origin:
			p += n
		unrolled.append(p)
	for q in unrolled.size():
		var from: int = unrolled[q] + 1
		var to: int = origin + n if q + 1 == unrolled.size() else unrolled[q + 1]
		if to <= from:
			continue
		var heads := PackedInt32Array()
		var turns := PackedInt32Array()
		for i in range(from, to):
			heads.append(target.heads[i % n])
			turns.append(target.turns[i % n])
		# Re-close the run: whatever final turn makes it loop exactly once.
		var sum := 0
		for i in turns.size() - 1:
			sum += turns[i]
		turns[turns.size() - 1] = 1 - sum
		var sub := _find_group(DGGBoundary.make(heads, turns), than, depth + 1)
		if sub.is_empty():
			return []
		for entry in sub:
			var lifted := PackedInt32Array()
			for p in (entry["positions"] as PackedInt32Array):
				lifted.append((from + p) % n)
			out.append({"index": entry["index"], "positions": lifted})
	return out


func summary() -> String:
	var lines := PackedStringArray()
	lines.append("grammar: %d rules from %d primitives (hierarchy %d graphs%s)" % [
		rules.size(), primitives.size(), hierarchy.size(),
		"" if exhausted else ", search bounded",
	])
	lines.append("  %d starter, %d splitting, %d substituting" % [
		stats.get("starter_rules", 0), stats.get("splitting_rules", 0),
		rules.size() - int(stats.get("starter_rules", 0)) - int(stats.get("splitting_rules", 0)),
	])
	return "\n".join(lines)
