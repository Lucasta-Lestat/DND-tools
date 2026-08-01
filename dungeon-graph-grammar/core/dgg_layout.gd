@tool
class_name DGGLayout
extends RefCounted

## Turns an angle graph into a graph drawing (§6.2–§6.3).
##
## The grammar produces graphs whose edges have known [i]angles[/i] but no
## positions or lengths. Because the angles are fixed, every edge contributes
## [code]p_w - p_u = s·(cos θ, sin θ)[/code], and the whole drawing collapses into
## one linear system. It is normally underdetermined, and the leftover freedom is
## the space of valid drawings; this class samples that space and rejects samples
## that break a rule, rather than optimising towards any particular shape.
##
## Three things get a sample rejected: an edge length outside the author's range,
## a pair of edges that cross, or an inconsistent system. Deciding whether a planar
## drawing exists at all is NP-hard in general (Garg 1998), so rejection sampling
## with an early exit is the honest approach — and in practice it lands quickly
## because each rule application only disturbs a small neighbourhood.

const NO_POSITION := Vector2(INF, INF)

var min_edge_length: float = 1.0
var max_edge_length: float = 8.0
## Sampling attempts per linear system (the paper's J).
var samples_per_system: int = 10
## How many times to widen the free-vertex set before giving up (the paper's I).
var relaxation_rounds: int = 5
## Upper bound on vertices allowed to move at once. The solve is dense, so this
## caps the per-proposal cost.
var max_free_vertices: int = 20
## Alternating-projection rounds spent pulling a sample back into the length range.
var repair_rounds: int = 8
## How far inside the length range the repair step aims, as a fraction of the
## range. Aiming at the exact bound tends to overshoot back out of it.
var box_margin: float = 0.05
var rng: RandomNumberGenerator
## Why the last call to [method realise] gave up. Useful when tuning an example's
## edge-length range, which is the usual cause of a stubbornly undrawable graph.
var last_failure: String = ""


func _init(p_rng: RandomNumberGenerator = null) -> void:
	rng = p_rng if p_rng else RandomNumberGenerator.new()


## Positions the vertices of [param graph] whose entries are [constant NO_POSITION],
## moving as few of the already-placed ones as possible.
##
## Returns true and writes into [code]graph.vertex_pos[/code] on success.
func realise(graph: DGGGraph) -> bool:
	var free := {}
	for v in graph.vertex_count:
		if _is_unplaced(graph.vertex_pos[v]):
			free[v] = true
	if free.is_empty():
		return _validate(graph, {})
	if free.size() == graph.vertex_count:
		# Nothing is placed yet, so the system is invariant under translation. Pin
		# one vertex at the origin to take that freedom out of the nullspace.
		graph.vertex_pos[0] = Vector2.ZERO
		free.erase(0)

	last_failure = "overconstrained"
	for round in relaxation_rounds:
		var system := _build(graph, free)
		var solution: Dictionary = DGGLinalg.solve(system["rows"], system["rhs"], system["cols"])
		if solution["ok"] and _sample(graph, system, solution, free):
			return true
		# Overconstrained, or every sample was rejected. Free one more vertex next
		# to the ones already moving and try again (Algorithm 3, line 9).
		if not _widen(graph, free):
			break
	return false


static func _is_unplaced(p: Vector2) -> bool:
	return is_inf(p.x) or is_inf(p.y) or is_nan(p.x)


# --- The linear system --------------------------------------------------------

func _build(graph: DGGGraph, free: Dictionary) -> Dictionary:
	var col_of_vertex := {}
	var cols := 0
	for v in free:
		col_of_vertex[v] = cols
		cols += 2
	# One length variable per edge that touches something we are allowed to move.
	var col_of_edge := {}
	var edges := _edge_list(graph)
	for e in edges.size():
		var edge: Dictionary = edges[e]
		if free.has(edge["tail"]) or free.has(edge["head"]):
			col_of_edge[e] = cols
			cols += 1

	var rows: Array = []
	var rhs := PackedFloat64Array()
	for e in edges.size():
		if not col_of_edge.has(e):
			continue
		var edge: Dictionary = edges[e]
		var dir: Vector2 = edge["dir"]
		var tail: int = edge["tail"]
		var head: int = edge["head"]
		var sc: int = col_of_edge[e]
		for axis in 2:
			var row := PackedFloat64Array()
			row.resize(cols)
			row.fill(0.0)
			var constant := 0.0
			if free.has(head):
				row[col_of_vertex[head] + axis] = 1.0
			else:
				constant -= graph.vertex_pos[head][axis]
			if free.has(tail):
				row[col_of_vertex[tail] + axis] = -1.0
			else:
				constant += graph.vertex_pos[tail][axis]
			row[sc] = -(dir.x if axis == 0 else dir.y)
			rows.append(row)
			rhs.append(constant)
	return {
		"rows": rows, "rhs": rhs, "cols": cols,
		"col_of_vertex": col_of_vertex, "col_of_edge": col_of_edge, "edges": edges,
	}


## Each undirected edge once, oriented along its label's angle so that the tail's
## spoke is the positive half-edge.
static func _edge_list(graph: DGGGraph) -> Array:
	var out: Array = []
	var seen := {}
	for s in graph.spoke_count():
		var p: int = graph.spoke_partner[s]
		if p < 0 or seen.has(s):
			continue
		seen[s] = true
		seen[p] = true
		var positive := s if DGGLabels.head_is_positive(graph.spoke_head[s]) else p
		var negative := p if positive == s else s
		var theta: float = graph.labels.edge_angle(DGGLabels.head_edge(graph.spoke_head[positive]))
		out.append({
			"tail": graph.spoke_vertex[positive],
			"head": graph.spoke_vertex[negative],
			"dir": Vector2(cos(deg_to_rad(theta)), sin(deg_to_rad(theta))),
			"spoke": positive,
		})
	return out


# --- Sampling (§6.3) ----------------------------------------------------------

func _sample(graph: DGGGraph, system: Dictionary, solution: Dictionary, free: Dictionary) -> bool:
	var basis: Array = solution["basis"]
	var particular: PackedFloat64Array = solution["x"]
	var cols: int = system["cols"]
	var backup := graph.vertex_pos.duplicate()
	var projector := _make_projector(basis, cols)

	# Two constraints have to hold at once: the drawing must lie in the affine
	# solution space, and every edge length must sit inside the author's range.
	# Each sample picks a random wish — arbitrary lengths in range, new vertices
	# near the existing graph — projects it onto the solution space, then bounces
	# between the two constraints until it settles. Blind jitter on Λ almost never
	# lands in the box once the range is tight; alternating projection usually does.
	var lo := min_edge_length + (max_edge_length - min_edge_length) * box_margin
	var hi := max_edge_length - (max_edge_length - min_edge_length) * box_margin
	for attempt in samples_per_system:
		var wish := _target_vector(graph, system, free, attempt > 0)
		var x := _project(projector, particular, basis, wish, cols)
		for repair in repair_rounds:
			if _lengths_in_range(system, x):
				break
			for e in system["col_of_edge"]:
				var c: int = system["col_of_edge"][e]
				x[c] = clampf(x[c], lo, hi)
			x = _project(projector, particular, basis, x, cols)
		_write_positions(graph, system, x)
		if _validate(graph, free):
			return true
	graph.vertex_pos = backup
	return false


## Precomputes [code](KᵀK)⁻¹Kᵀ[/code] in factored form. The nullspace basis is
## fixed for a given system, so this is built once and reused by every projection.
static func _make_projector(basis: Array, cols: int) -> Array:
	var k := basis.size()
	if k == 0:
		return []
	var normal: Array = []
	for i in k:
		var row := PackedFloat64Array()
		row.resize(k)
		var bi: PackedFloat64Array = basis[i]
		for j in k:
			var bj: PackedFloat64Array = basis[j]
			var dot := 0.0
			for c in cols:
				dot += bi[c] * bj[c]
			row[j] = dot
		normal.append(row)
	return DGGLinalg.invert(normal, k)


## The point of [code]x̂ + KΛ[/code] closest to [param wish].
static func _project(projector: Array, particular: PackedFloat64Array, basis: Array,
		wish: PackedFloat64Array, cols: int) -> PackedFloat64Array:
	var x := particular.duplicate()
	var k := basis.size()
	if k == 0 or projector.is_empty():
		return x
	var rhs := PackedFloat64Array()
	rhs.resize(k)
	for i in k:
		var bi: PackedFloat64Array = basis[i]
		var dot := 0.0
		for c in cols:
			dot += bi[c] * (wish[c] - particular[c])
		rhs[i] = dot
	for i in k:
		var row: PackedFloat64Array = projector[i]
		var lam := 0.0
		for j in k:
			lam += row[j] * rhs[j]
		if lam == 0.0:
			continue
		var bi: PackedFloat64Array = basis[i]
		for c in cols:
			x[c] += lam * bi[c]
	return x


func _lengths_in_range(system: Dictionary, x: PackedFloat64Array) -> bool:
	for e in system["col_of_edge"]:
		var s: float = x[system["col_of_edge"][e]]
		if s < min_edge_length - 1e-6 or s > max_edge_length + 1e-6:
			return false
	return true


## A drawing to aim for. The first attempt asks for mid-range lengths, which is
## the safest guess; later attempts randomise so the walk samples the space of
## valid drawings rather than always producing the same one.
func _target_vector(graph: DGGGraph, system: Dictionary, free: Dictionary,
		randomise: bool) -> PackedFloat64Array:
	var cols: int = system["cols"]
	var target := PackedFloat64Array()
	target.resize(cols)
	target.fill(0.0)
	var anchor := _anchor(graph, free)
	var spread := (max_edge_length + min_edge_length) * 0.5
	for v in system["col_of_vertex"]:
		var c: int = system["col_of_vertex"][v]
		var jitter := Vector2(rng.randfn(0.0, spread), rng.randfn(0.0, spread)) \
				if randomise else Vector2.ZERO
		target[c] = anchor.x + jitter.x
		target[c + 1] = anchor.y + jitter.y
	var mid := (min_edge_length + max_edge_length) * 0.5
	for e in system["col_of_edge"]:
		target[system["col_of_edge"][e]] = \
				rng.randf_range(min_edge_length, max_edge_length) if randomise else mid
	return target


## The average position of the placed neighbours of anything being moved — a
## better guess than the origin when the graph has wandered far from it.
func _anchor(graph: DGGGraph, free: Dictionary) -> Vector2:
	var sum := Vector2.ZERO
	var n := 0
	for v in free:
		for s in graph.vertex_spokes[v]:
			var p: int = graph.spoke_partner[s]
			if p < 0:
				continue
			var w: int = graph.spoke_vertex[p]
			if free.has(w) or _is_unplaced(graph.vertex_pos[w]):
				continue
			sum += graph.vertex_pos[w]
			n += 1
	return sum / n if n > 0 else Vector2.ZERO


func _write_positions(graph: DGGGraph, system: Dictionary, x: PackedFloat64Array) -> void:
	for v in system["col_of_vertex"]:
		var c: int = system["col_of_vertex"][v]
		graph.vertex_pos[v] = Vector2(x[c], x[c + 1])


# --- Acceptance (§6.3) --------------------------------------------------------

func _validate(graph: DGGGraph, free: Dictionary) -> bool:
	var edges := _edge_list(graph)
	var segments: Array = []
	for edge in edges:
		var a: Vector2 = graph.vertex_pos[edge["tail"]]
		var b: Vector2 = graph.vertex_pos[edge["head"]]
		if _is_unplaced(a) or _is_unplaced(b):
			last_failure = "vertex left unplaced"
			return false
		var length := a.distance_to(b)
		if length < min_edge_length - 1e-4 or length > max_edge_length + 1e-4:
			last_failure = "edge length %.2f outside [%.2f, %.2f]" % [
					length, min_edge_length, max_edge_length]
			return false
		# The direction has to agree with the label, or the shape is not locally
		# similar to the example any more.
		if (b - a).normalized().dot(edge["dir"]) < 0.999:
			last_failure = "edge points the wrong way"
			return false
		segments.append({"a": a, "b": b, "u": edge["tail"], "w": edge["head"],
				"moved": free.has(edge["tail"]) or free.has(edge["head"])})
	if not _no_crossings(segments):
		last_failure = "walls cross"
		return false
	return true


## Rejects drawings whose edges cross. Only segments touching a moved vertex can
## have become bad, so those are the only ones tested against the rest.
static func _no_crossings(segments: Array) -> bool:
	for i in segments.size():
		var s: Dictionary = segments[i]
		if not s["moved"]:
			continue
		for j in segments.size():
			if i == j:
				continue
			var o: Dictionary = segments[j]
			# Edges meeting at a shared vertex are supposed to touch.
			if s["u"] == o["u"] or s["u"] == o["w"] or s["w"] == o["u"] or s["w"] == o["w"]:
				continue
			if Geometry2D.segment_intersects_segment(s["a"], s["b"], o["a"], o["b"]) != null:
				return false
	return true


## Lets the whole ring of vertices around the moving set move too.
##
## A newly inserted piece usually cannot fit between sockets held rigidly in place:
## the system comes out overconstrained, or solvable only at edge lengths outside
## the author's range. Releasing a ring at a time gives the solver enough slack to
## push the surrounding rooms apart, which is what the paper's incremental
## vertex-freeing does, one degree of freedom at a time.
func _widen(graph: DGGGraph, free: Dictionary) -> bool:
	var ring: Array[int] = []
	for v in free:
		for s in graph.vertex_spokes[v]:
			var p: int = graph.spoke_partner[s]
			if p < 0:
				continue
			var w: int = graph.spoke_vertex[p]
			if not free.has(w) and not ring.has(w):
				ring.append(w)
	# An anchored vertex must not move either, or the author's room would survive
	# the graph rewrite only to be dragged out of shape by the solver.
	for i in range(ring.size() - 1, -1, -1):
		if graph.is_frozen(ring[i]):
			ring.remove_at(i)
	if ring.is_empty():
		return false
	# Keep one vertex nailed down. With everything loose the system only fixes the
	# drawing up to translation, and samples wander off into the plane instead of
	# staying where the rest of the dungeon is.
	if free.size() + ring.size() >= graph.vertex_count and ring.size() > 1:
		ring.remove_at(rng.randi() % ring.size())
	# Past a certain size the dense solve costs more than the extra freedom is
	# worth, so take a random slice of the ring instead of all of it.
	while free.size() + ring.size() > max_free_vertices and ring.size() > 1:
		ring.remove_at(rng.randi() % ring.size())
	for v in ring:
		free[v] = true
	return true
