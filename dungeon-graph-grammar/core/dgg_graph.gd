@tool
class_name DGGGraph
extends RefCounted

## A labelled plane graph, stored as a rotation system.
##
## The unit of structure is the [b]spoke[/b]: one ray leaving one vertex. A spoke
## either points at a partner spoke — together they are a full edge — or dangles,
## in which case it is one of the paper's half-edges and is waiting to be glued.
## Each vertex keeps its spokes in counter-clockwise order, and that ordering is
## the whole embedding: no coordinates are needed until the drawing stage (§6).
##
## Every graph carries its boundary string (see [DGGBoundary]) plus
## [member boundary_spokes], which says which spoke each position of the string
## refers to. Keeping the two in step means gluing never has to re-walk the
## boundary from scratch — the string algebra decides [i]whether[/i] a glue is
## legal and the spoke table records [i]what[/i] to connect.
##
## All graphs built by this class are connected. Rules may have several graphs on
## one side, but each of those is a separate connected [DGGGraph]; see [DGGRule].

var labels: DGGLabels

var vertex_count: int = 0
## Spoke tables, all indexed by spoke id.
var spoke_vertex: PackedInt32Array = PackedInt32Array()
var spoke_head: PackedInt32Array = PackedInt32Array()
var spoke_partner: PackedInt32Array = PackedInt32Array()  ## -1 when dangling
## Per vertex, its spoke ids in counter-clockwise order.
var vertex_spokes: Array = []

var boundary: DGGBoundary
## Parallel to [code]boundary.heads[/code]: the spoke each half-edge position names.
var boundary_spokes: PackedInt32Array = PackedInt32Array()

## Optional geometry, filled in by [DGGLayout]. Empty on abstract angle graphs.
var vertex_pos: PackedVector2Array = PackedVector2Array()
## Vertices the author pinned. A frozen vertex is never matched by a rule, so it
## is never cut out, and any wall running between two frozen vertices survives
## every rewrite intact. Empty means nothing is pinned.
var vertex_frozen: PackedByteArray = PackedByteArray()

var _canonical_cache: String = ""


## Builds a [i]primitive[/i]: one vertex with every incident edge cut, which is the
## smallest piece the input can be broken into (§4.1). [param heads] may be given in
## any order; they are sorted counter-clockwise here.
##
## The boundary of a primitive is simply its half-edges in counter-clockwise order
## followed by a single [code]∧[/code]: walking around a lone vertex star, the only
## place the tangent angle wraps is where the walk closes up.
static func from_vertex(p_labels: DGGLabels, heads: Array) -> DGGGraph:
	var g := DGGGraph.new()
	g.labels = p_labels
	g.vertex_count = 1
	var sorted: Array = heads.duplicate()
	sorted.sort_custom(func(a, b): return p_labels.head_direction(a) < p_labels.head_direction(b))
	var ring := PackedInt32Array()
	for i in sorted.size():
		g.spoke_vertex.append(0)
		g.spoke_head.append(sorted[i])
		g.spoke_partner.append(-1)
		ring.append(i)
	g.vertex_spokes = [ring]
	var turns := PackedInt32Array()
	turns.resize(maxi(sorted.size(), 1))
	turns.fill(0)
	turns[turns.size() - 1] = 1
	g.boundary = DGGBoundary.make(PackedInt32Array(sorted), turns)
	g.boundary_spokes = ring.duplicate()
	return g


func duplicate_graph() -> DGGGraph:
	var g := DGGGraph.new()
	g.labels = labels
	g.vertex_count = vertex_count
	g.spoke_vertex = spoke_vertex.duplicate()
	g.spoke_head = spoke_head.duplicate()
	g.spoke_partner = spoke_partner.duplicate()
	g.vertex_spokes = []
	for ring in vertex_spokes:
		g.vertex_spokes.append((ring as PackedInt32Array).duplicate())
	g.boundary = boundary.duplicate_boundary()
	g.boundary_spokes = boundary_spokes.duplicate()
	g.vertex_pos = vertex_pos.duplicate()
	g.vertex_frozen = vertex_frozen.duplicate()
	return g


func is_frozen(v: int) -> bool:
	return v < vertex_frozen.size() and vertex_frozen[v] != 0


func freeze_vertex(v: int) -> void:
	if vertex_frozen.size() < vertex_count:
		var grown := PackedByteArray()
		grown.resize(vertex_count)
		grown.fill(0)
		for i in vertex_frozen.size():
			grown[i] = vertex_frozen[i]
		vertex_frozen = grown
	vertex_frozen[v] = 1


func frozen_count() -> int:
	var n := 0
	for f in vertex_frozen:
		if f != 0:
			n += 1
	return n


func spoke_count() -> int:
	return spoke_vertex.size()


func edge_count() -> int:
	var n := 0
	for p in spoke_partner:
		if p >= 0:
			n += 1
	return n / 2


## Edges a creature could pass through: doorways and anything else the author
## gave a non-wall kind.
func passable_edge_count() -> int:
	var n := 0
	for s in spoke_count():
		if spoke_partner[s] >= 0 and labels.edge_is_passable(DGGLabels.head_edge(spoke_head[s])):
			n += 1
	return n / 2


func dangling_count() -> int:
	return boundary.size()


func is_complete() -> bool:
	return boundary.is_complete()


func direction_of(spoke: int) -> float:
	return labels.head_direction(spoke_head[spoke])


# --- Gluing -------------------------------------------------------------------

## Positions where two of this graph's own half-edges can be joined, closing a
## face. Delegates the legality test to the boundary string.
func loop_glue_sites() -> PackedInt32Array:
	return boundary.loop_glue_sites()


## True when closing this site would create an edge that no straight-line drawing
## can realise, so there is no point carrying the result into the hierarchy.
##
## Two cases: a spoke joined to another spoke of the same vertex would be an edge
## from a point back to itself, and a second edge between two vertices already
## joined would have to lie exactly on top of the first. The boundary string alone
## cannot see either — both are perfectly well-formed as cyclic words — which is
## why the check lives here, on the graph, next to the vertex tables.
func loop_glue_is_degenerate(site: int) -> bool:
	var k := boundary.size()
	var a := boundary_spokes[site]
	var b := boundary_spokes[(site + 1) % k]
	var va := spoke_vertex[a]
	var vb := spoke_vertex[b]
	if va == vb:
		return true
	for s in vertex_spokes[va]:
		var p: int = spoke_partner[s]
		if p >= 0 and spoke_vertex[p] == vb:
			return true
	return false


func loop_glued(site: int) -> DGGGraph:
	var g := duplicate_graph()
	var k := boundary.size()
	var s0 := boundary_spokes[site]
	var s1 := boundary_spokes[(site + 1) % k]
	g.spoke_partner[s0] = s1
	g.spoke_partner[s1] = s0
	g.boundary = boundary.loop_glued(site)
	# The survivors keep the order the boundary rewrite gave them: everything
	# after the glued pair, wrapping round.
	g.boundary_spokes = PackedInt32Array()
	for i in k - 2:
		g.boundary_spokes.append(boundary_spokes[(site + 2 + i) % k])
	g._canonical_cache = ""
	return g


## Joins this graph to a separate graph at one half-edge each (§4.2, branch gluing).
## [param i] indexes a position in this boundary and [param j] a complementary
## position in [param other].
func branch_glued(other: DGGGraph, i: int, j: int) -> DGGGraph:
	var g := duplicate_graph()
	var v_off := vertex_count
	var s_off := spoke_count()
	g.vertex_count += other.vertex_count
	for s in other.spoke_count():
		g.spoke_vertex.append(other.spoke_vertex[s] + v_off)
		g.spoke_head.append(other.spoke_head[s])
		var p: int = other.spoke_partner[s]
		g.spoke_partner.append(-1 if p < 0 else p + s_off)
	for ring in other.vertex_spokes:
		var shifted := PackedInt32Array()
		for s in ring:
			shifted.append(s + s_off)
		g.vertex_spokes.append(shifted)
	var a := boundary_spokes[i]
	var b: int = other.boundary_spokes[j] + s_off
	g.spoke_partner[a] = b
	g.spoke_partner[b] = a
	g.boundary = boundary.branch_glued(other.boundary, i, j)
	# DGGBoundary.branch_glued emits B₁ then B₂, so mirror that order here.
	g.boundary_spokes = PackedInt32Array()
	var k1 := boundary.size()
	var k2 := other.boundary.size()
	for n in k1 - 1:
		g.boundary_spokes.append(boundary_spokes[(i + 1 + n) % k1])
	for n in k2 - 1:
		g.boundary_spokes.append(other.boundary_spokes[(j + 1 + n) % k2] + s_off)
	g._canonical_cache = ""
	return g


# --- Identity -----------------------------------------------------------------

## A canonical code for the labelled rotation system, used to deduplicate the
## hierarchy. Roots a deterministic breadth-first walk at every spoke in turn and
## keeps the smallest code; two graphs share a code exactly when an
## orientation-preserving isomorphism maps one onto the other.
func canonical_key() -> String:
	if _canonical_cache != "":
		return _canonical_cache
	if spoke_vertex.is_empty():
		_canonical_cache = "empty"
		return _canonical_cache
	var best := ""
	for s0 in spoke_count():
		var code := _code_from(s0)
		if best == "" or code < best:
			best = code
	_canonical_cache = best
	return best


func _code_from(root: int) -> String:
	var vindex := {}
	var vroot := {}
	var queue: Array[int] = [root]
	vindex[spoke_vertex[root]] = 0
	vroot[spoke_vertex[root]] = root
	var parts := PackedStringArray()
	var qi := 0
	while qi < queue.size():
		var start: int = queue[qi]
		qi += 1
		var v := spoke_vertex[start]
		var ring: PackedInt32Array = vertex_spokes[v]
		var deg := ring.size()
		var base := ring.find(start)
		var row := PackedStringArray()
		for t in deg:
			var s: int = ring[(base + t) % deg]
			var p: int = spoke_partner[s]
			if p < 0:
				row.append("%d." % spoke_head[s])
				continue
			var w := spoke_vertex[p]
			if not vindex.has(w):
				vindex[w] = vindex.size()
				vroot[w] = p
				queue.append(p)
				row.append("%d>n" % spoke_head[s])
			else:
				var wring: PackedInt32Array = vertex_spokes[w]
				var offset := posmod(wring.find(p) - wring.find(vroot[w]), wring.size())
				row.append("%d>%d:%d" % [spoke_head[s], vindex[w], offset])
		parts.append(",".join(row))
	return ";".join(parts)


## Walks every face of a complete graph, returning the spokes each face runs
## along plus a spoke-to-face index.
##
## From a spoke, step to its partner and take the next spoke counter-clockwise.
## That keeps the face being traced on the walk's [b]right[/b], so a bounded room
## comes out clockwise (negative signed area) and the unbounded outside comes out
## counter-clockwise. Renderers use the sign to tell rooms from the surrounding
## rock; getting it backwards fills the whole footprint with one colour and only
## looks right when every room shares a label.
##
## Returns [code]{cycles, face_of_spoke}[/code]. Everything that needs faces goes
## through here — the walk is subtle enough that a second copy of it is a bug
## waiting to happen.
func face_cycles() -> Dictionary:
	var cycles: Array = []
	var face_of_spoke := PackedInt32Array()
	face_of_spoke.resize(spoke_count())
	face_of_spoke.fill(-1)
	for start in spoke_count():
		if face_of_spoke[start] >= 0 or spoke_partner[start] < 0:
			continue
		var index := cycles.size()
		var cycle := PackedInt32Array()
		var d := start
		while face_of_spoke[d] < 0:
			face_of_spoke[d] = index
			cycle.append(d)
			var p: int = spoke_partner[d]
			if p < 0:
				break
			var ring: PackedInt32Array = vertex_spokes[spoke_vertex[p]]
			d = ring[(ring.find(p) + 1) % ring.size()]
		cycles.append(cycle)
	return {"cycles": cycles, "face_of_spoke": face_of_spoke}


## The faces as [code]{label, vertices}[/code], for renderers.
func trace_faces() -> Array:
	var out: Array = []
	for cycle in face_cycles()["cycles"]:
		var spokes: PackedInt32Array = cycle
		if spokes.is_empty():
			continue
		var verts := PackedInt32Array()
		for d in spokes:
			verts.append(spoke_vertex[d])
		out.append({
			"label": labels.head_right_face(spoke_head[spokes[0]]),
			"vertices": verts,
		})
	return out


## [code]V - E + F[/code] for a complete graph. A [i]connected[/i] rotation system
## that really does embed in the plane gives 2; 0 means a handle, and no planar
## drawing exists. Note the count is per component: a graph in [code]c[/code] planar
## pieces scores [code]2c[/code], not 2, because [method trace_faces] walks each
## component's outer face separately. Test [method is_one_piece] first, or a merely
## disconnected result looks like a non-planar one.
##
## Worth checking because gluing is a local operation: a rule guarantees that its
## two sides present the same boundary, but not that the pieces were sitting in the
## host graph in the arrangement the rule assumed. Measured, that only ever bites
## when the source side has several components — cutting out a single connected
## piece preserves every rotation ring, so the hole's sockets always come round in
## boundary-string order and the result is planar.
##
## This test is necessary but not sufficient for a drawing to exist: it knows
## nothing about the angles. See [method faces_are_realisable] for that half.
func euler_characteristic() -> int:
	return vertex_count - edge_count() + trace_faces().size()


## Whether every face could be drawn with the angles its labels demand.
##
## [method euler_characteristic] only says the rotation system embeds on a sphere.
## It says nothing about the angles, and the angles are the whole point of local
## similarity. Two things can still go wrong, and both are invisible to Euler:
##
## - A face may [b]wind twice[/b]. Its tangent turns through 720° rather than 360°,
##   so it closes only by lapping itself. The boundary algebra rules this out on a
##   half-built graph — that is what [code]sum(turns) == 1[/code] means — but after
##   surgery nothing re-checks it.
## - A face's edge directions may all lie in one [b]half-plane[/b]. Closing it needs
##   [code]Σ s·u = 0[/code] with every [code]s > 0[/code], which is possible exactly
##   when the sorted directions leave no angular gap wider than 180°. Otherwise the
##   only solution has a zero-length edge.
##
## Both are cheap and certain here; left to [DGGLayout] they cost a whole rejection
## sampling budget and come back as a misleading "walls cross" or "edge length 0.00".
func faces_are_realisable() -> bool:
	for cycle in face_cycles()["cycles"]:
		var k: int = (cycle as PackedInt32Array).size()
		if k < 2:
			return false  # a face bounded by one spoke is a self-loop
		var turning := 0.0
		var angles: Array[float] = []
		for i in k:
			var here: int = cycle[i]
			var there: int = cycle[(i + 1) % k]
			# A walk that leaves along the spoke it arrived on has reached a
			# dead end, and reverses by exactly 180 degrees. Angle arithmetic
			# cannot say which way it swung, so decline to judge rather than risk
			# rejecting a drawable graph; the layout stage will settle it. The
			# polygon authoring path cannot produce a degree-1 vertex, so this is
			# a guard against future inputs, not a case seen today.
			if there == spoke_partner[here]:
				return true
			var a := labels.head_direction(spoke_head[here])
			var b := labels.head_direction(spoke_head[there])
			turning += DGGLabels.normalize_180(b - a)
			angles.append(a)
		if absf(absf(turning) - 360.0) > 1.0:
			return false
		angles.sort()
		var widest := 0.0
		for i in k:
			var lo: float = angles[i]
			var hi: float = angles[(i + 1) % k] + (360.0 if i == k - 1 else 0.0)
			widest = maxf(widest, hi - lo)
		if widest > 180.0 + 1e-3:
			return false
	return true


func is_one_piece() -> bool:
	if vertex_count <= 1:
		return true
	var seen := {0: true}
	var queue: Array[int] = [0]
	var qi := 0
	while qi < queue.size():
		var v: int = queue[qi]
		qi += 1
		for s in vertex_spokes[v]:
			var p: int = spoke_partner[s]
			if p < 0:
				continue
			var w: int = spoke_vertex[p]
			if not seen.has(w):
				seen[w] = true
				queue.append(w)
	return seen.size() == vertex_count


func describe() -> String:
	return "V%d E%d ∂=%s" % [vertex_count, edge_count(), str(boundary)]
