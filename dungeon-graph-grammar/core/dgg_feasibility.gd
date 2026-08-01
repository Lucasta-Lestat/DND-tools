@tool
class_name DGGFeasibility
extends RefCounted

## What can this example's grammar actually produce — worked out before generating.
##
## A user who wants to constrain the output ("keep interior walls at a third of
## the total", "give me a donut") is assuming those quantities are free to vary.
## Mostly they are not, and the reason is exact rather than statistical.
##
## Every vertex of a finished dungeon is an instance of one of the example's
## primitives — that is what local similarity means, and what [DGGGenerator]'s
## matcher enforces. Let [code]n_p[/code] count how many vertices are of primitive
## type [code]p[/code]. Every half-edge in a finished dungeon is glued to its
## complement, so for each edge label the two sides must appear equally often:
## [codeblock lang=text]
##   for each edge label e:   Σ_p n_p · ( #ē in p  −  #e in p )  =  0
## [/codeblock]
## That is a linear system [code]M·n = 0[/code], and everything a ratio constraint
## could name — vertex count, edge count, room count, every label count — is a
## linear function of [code]n[/code]. So the achievable label vectors are not a
## free five- or ten-dimensional space; they are the image of a cone whose
## dimension is usually far smaller than the number of primitives.
##
## Two things fall out, and both belong in front of the user rather than buried in
## a sampler that quietly fails to hit their target:
##
## - [b]Exact invariants.[/b] Linear relations that hold in [i]every[/i] dungeon the
##   grammar can produce, e.g. "the count of one label always equals another's".
##   Asking for a ratio that violates one is asking for the impossible.
## - [b]Reachable ratio ranges.[/b] The interval each label's share can occupy.
##
## This is a necessary condition, not a sufficient one: it ignores planarity and
## drawability, so the true reachable set is a subset of what is reported here.
## An unreachable request is therefore a definite no; a reachable one is a maybe.

var labels: DGGLabels
var primitives: Array[DGGGraph] = []
## Dimension of the cone of achievable primitive-usage vectors.
var cone_dimension: int = 0
## Exact linear relations among edge-label counts. Each is a dictionary of
## [code]label index → coefficient[/code] that sums to zero in every output.
var invariants: Array = []
## Per edge label, the [code][min, max][/code] share of total edges it can occupy,
## estimated by sampling the cone. Empty when the cone could not be sampled.
var ratio_range: Array = []
## Plain-language notes about what the example cannot express.
var limits: PackedStringArray = PackedStringArray()

var _usage_basis: Array = []


static func analyse(example: DGGExample) -> DGGFeasibility:
	var f := DGGFeasibility.new()
	f.labels = example.labels
	f.primitives = example.primitives.duplicate()
	f._solve_cone()
	f._find_invariants()
	f._sample_ratios()
	f._describe_limits(example)
	return f


# --- The cone -----------------------------------------------------------------

## Counts of each half-edge sign per primitive. Row per edge label, column per
## primitive, entry = (times the positive half-edge appears) - (times the negative
## one does). A finished dungeon needs every row to come out zero.
func _pairing_matrix() -> Array:
	var rows: Array = []
	for e in labels.edge_count():
		var row := PackedFloat64Array()
		row.resize(primitives.size())
		row.fill(0.0)
		for p in primitives.size():
			for h in primitives[p].boundary.heads:
				if DGGLabels.head_edge(h) == e:
					row[p] += 1.0 if DGGLabels.head_is_positive(h) else -1.0
		rows.append(row)
	return rows


## Positive half-edge counts per primitive: the matrix taking a usage vector to
## the edge-label counts of the dungeon it describes.
func _label_matrix() -> Array:
	var rows: Array = []
	for e in labels.edge_count():
		var row := PackedFloat64Array()
		row.resize(primitives.size())
		row.fill(0.0)
		for p in primitives.size():
			for h in primitives[p].boundary.heads:
				if DGGLabels.head_edge(h) == e and DGGLabels.head_is_positive(h):
					row[p] += 1.0
		rows.append(row)
	return rows


func _solve_cone() -> void:
	if primitives.is_empty():
		return
	var rhs := PackedFloat64Array()
	rhs.resize(labels.edge_count())
	rhs.fill(0.0)
	var solution: Dictionary = DGGLinalg.solve(_pairing_matrix(), rhs, primitives.size())
	if not solution["ok"]:
		return
	_usage_basis = solution["basis"]
	cone_dimension = _usage_basis.size()


# --- Exact invariants ---------------------------------------------------------

## Relations among label counts that no output can break.
##
## Label counts are [code]c = A·n[/code] and usage vectors are confined to
## [code]ker M[/code], spanned by [code]K[/code]. So [code]c[/code] is confined to
## the column space of [code]A·K[/code], and any vector [code]y[/code] with
## [code]yᵀ(A·K) = 0[/code] gives a relation [code]y·c = 0[/code] that holds
## everywhere. Those [code]y[/code] are the nullspace of [code](A·K)ᵀ[/code].
func _find_invariants() -> void:
	invariants = []
	if _usage_basis.is_empty():
		return
	var a := _label_matrix()
	var n_labels := a.size()
	var d := _usage_basis.size()
	# (A·K)ᵀ, one row per basis direction, one column per label.
	var rows: Array = []
	var rhs := PackedFloat64Array()
	for j in d:
		var basis: PackedFloat64Array = _usage_basis[j]
		var row := PackedFloat64Array()
		row.resize(n_labels)
		for e in n_labels:
			var dot := 0.0
			var arow: PackedFloat64Array = a[e]
			for p in primitives.size():
				dot += arow[p] * basis[p]
			row[e] = dot
		rows.append(row)
		rhs.append(0.0)
	var solution: Dictionary = DGGLinalg.solve(rows, rhs, n_labels)
	if not solution["ok"]:
		return
	for vec in solution["basis"]:
		var relation := {}
		for e in n_labels:
			if absf(vec[e]) > 1e-6:
				relation[e] = vec[e]
		if relation.size() >= 2:
			invariants.append(relation)


# --- Reachable ratios ---------------------------------------------------------

## Estimates each label's achievable share of the total by sampling non-negative
## points of the cone. Sampling rather than enumerating extreme rays: the exact
## answer is a double-description problem, and the interval is only meant to tell
## a user whether the number they typed is inside or outside.
func _sample_ratios() -> void:
	ratio_range = []
	if _usage_basis.is_empty():
		return
	var n_labels := labels.edge_count()
	var lo := PackedFloat64Array()
	var hi := PackedFloat64Array()
	lo.resize(n_labels)
	hi.resize(n_labels)
	lo.fill(INF)
	hi.fill(-INF)
	var a := _label_matrix()
	var rng := RandomNumberGenerator.new()
	rng.seed = 12345
	var found := 0
	for trial in 4000:
		var n := PackedFloat64Array()
		n.resize(primitives.size())
		n.fill(0.0)
		for j in _usage_basis.size():
			var coeff := rng.randf_range(0.0, 1.0)
			var basis: PackedFloat64Array = _usage_basis[j]
			for p in primitives.size():
				n[p] += coeff * basis[p]
		var ok := true
		for p in primitives.size():
			if n[p] < -1e-9:
				ok = false
				break
		if not ok:
			continue
		var counts := PackedFloat64Array()
		counts.resize(n_labels)
		var total := 0.0
		for e in n_labels:
			var dot := 0.0
			var arow: PackedFloat64Array = a[e]
			for p in primitives.size():
				dot += arow[p] * n[p]
			counts[e] = dot
			total += dot
		if total <= 1e-9:
			continue
		found += 1
		for e in n_labels:
			var share := counts[e] / total
			lo[e] = minf(lo[e], share)
			hi[e] = maxf(hi[e], share)
	if found == 0:
		return
	for e in n_labels:
		ratio_range.append([lo[e], hi[e]])


# --- Structural limits --------------------------------------------------------

func _describe_limits(example: DGGExample) -> void:
	limits = PackedStringArray()
	var max_degree := 0
	for p in primitives:
		max_degree = maxi(max_degree, p.boundary.size())
	if max_degree < 4:
		limits.append("no junction in the example has 4 or more walls meeting, "
				+ "so no output can contain a crossing — only corners and T-junctions")
	# Which ordered face pairs have a wall label, and at which angles.
	var angles_by_pair := {}
	for e in labels.edge_count():
		var key := "%s|%s" % [labels.face_name(labels.edge_left(e)),
				labels.face_name(labels.edge_right(e))]
		if not angles_by_pair.has(key):
			angles_by_pair[key] = []
		angles_by_pair[key].append(labels.edge_angle(e))
	var interior := PackedStringArray()
	for name in example.labels.face_names:
		if name == example.outer_face:
			continue
		var key := "%s|%s" % [name, name]
		if angles_by_pair.has(key):
			var dirs := PackedStringArray()
			for a in angles_by_pair[key]:
				dirs.append("%.0f°" % a)
			interior.append("%s walls only at %s" % [key, ", ".join(dirs)])
		else:
			interior.append("no %s wall exists, so two %s rooms can never share one"
					% [key, name])
	for line in interior:
		limits.append(line)
	if cone_dimension <= 1:
		limits.append("the usage cone is %d-dimensional: every output is the same "
				% cone_dimension + "shape at a different size, with no free ratio at all")


# --- Reporting ----------------------------------------------------------------

func summary() -> String:
	var lines := PackedStringArray()
	lines.append("feasibility: %d primitives, %d edge labels, usage cone dimension %d"
			% [primitives.size(), labels.edge_count(), cone_dimension])
	if invariants.is_empty():
		lines.append("  no exact relations between label counts")
	else:
		lines.append("  %d relation(s) hold in every possible output:" % invariants.size())
		for relation in invariants:
			lines.append("    %s" % _format_relation(relation))
	for e in ratio_range.size():
		var band: Array = ratio_range[e]
		var name := _label_name(e)
		if band[1] - band[0] < 1e-6:
			lines.append("    %-22s fixed at %.1f%% of all walls" % [name, band[0] * 100.0])
		else:
			lines.append("    %-22s can be %.1f%% – %.1f%% of all walls"
					% [name, band[0] * 100.0, band[1] * 100.0])
	for line in limits:
		lines.append("  limit: %s" % line)
	return "\n".join(lines)


## Whether a requested share for [param edge_label] is inside the reachable band.
func ratio_is_reachable(edge_label: int, share: float) -> bool:
	if edge_label < 0 or edge_label >= ratio_range.size():
		return false
	var band: Array = ratio_range[edge_label]
	return share >= band[0] - 1e-3 and share <= band[1] + 1e-3


func _label_name(e: int) -> String:
	return "%s|%s@%.0f°" % [labels.face_name(labels.edge_left(e)),
			labels.face_name(labels.edge_right(e)), labels.edge_angle(e)]


func _format_relation(relation: Dictionary) -> String:
	var left := PackedStringArray()
	var right := PackedStringArray()
	var scale := 0.0
	for e in relation:
		scale = maxf(scale, absf(relation[e]))
	for e in relation:
		var coeff: float = relation[e] / maxf(scale, 1e-9)
		var term := _label_name(e) if absf(absf(coeff) - 1.0) < 1e-3 \
				else "%.2f×%s" % [absf(coeff), _label_name(e)]
		if coeff > 0.0:
			left.append(term)
		else:
			right.append(term)
	if left.is_empty() or right.is_empty():
		return "%s%s = 0" % [" + ".join(left), " + ".join(right)]
	return "%s = %s" % [" + ".join(left), " + ".join(right)]
