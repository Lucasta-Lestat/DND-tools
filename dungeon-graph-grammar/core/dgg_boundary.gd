@tool
class_name DGGBoundary
extends RefCounted

## The boundary string of a graph, written [code]∂G[/code] in Merrell 2023 (§3.3).
##
## The boundary is the closed counter-clockwise walk around a graph's ribbon
## neighbourhood. It records two things and nothing else:
##
## [b]1. Half-edges.[/b] Every dangling half-edge is crossed exactly once by the
## walk. A half-edge is an integer id; complementary half-edges (the paper's
## [code]a[/code] and [code]ā[/code], the two sides of one cut edge) differ only
## in bit 0, so [method opposite] is a single xor.
##
## [b]2. Turns.[/b] The walk's tangent angle is tracked in [code][-180°, 180°)[/code].
## Each time it wraps past +180° the paper writes a positive turn [code]∧[/code];
## each wrap the other way is a negative turn [code]∨[/code]. Consecutive opposite
## turns cancel ([code]a∧x∧∨ = a∧x[/code]), so only the [i]net[/i] turn between two
## consecutive half-edges carries information. We store that net count as a signed
## integer, which makes the whole algebra exact integer arithmetic.
##
## So a boundary is stored as two parallel arrays: [member heads] holds the
## half-edge ids in walk order, and [member turns] holds the net turn that follows
## each one. For a graph with no half-edges left (a [i]complete[/i] graph) [member heads]
## is empty and [member turns] holds the single accumulated wrap.
##
## The walk is a loop, so the arrays are [b]cyclic[/b]: [code]y∧ba = ∧bay = bay∧[/code].
## [method canonical_key] picks the lexicographically smallest rotation so that two
## boundaries can be compared with a string equality.
##
## [b]Invariant:[/b] the walk loops exactly once counter-clockwise, so the turns
## always sum to +1 ([code]P_G - N_G = 1[/code] in the paper).

## Half-edge ids in the order the boundary walk crosses them.
var heads: PackedInt32Array
## [code]turns[i][/code] is the net turn between [code]heads[i][/code] and
## [code]heads[i + 1][/code] (cyclically). Same length as [member heads], except
## for a complete graph where [member heads] is empty and this holds one element.
var turns: PackedInt32Array


## Returns the complementary half-edge: the paper's [code]a ↔ ā[/code].
static func opposite(head: int) -> int:
	return head ^ 1


## Returns true if the two half-edges are the two sides of one cut edge.
static func are_complementary(a: int, b: int) -> bool:
	return (a ^ 1) == b


static func make(p_heads: Array, p_turns: Array) -> DGGBoundary:
	var b := DGGBoundary.new()
	b.heads = PackedInt32Array(p_heads)
	b.turns = PackedInt32Array(p_turns)
	assert(b.turns.size() == maxi(b.heads.size(), 1), "turns must parallel heads")
	assert(b.total_turn() == 1, "boundary must loop once counter-clockwise")
	return b


## The boundary of a complete graph: no half-edges, one positive turn ([code]∧[/code]).
static func complete() -> DGGBoundary:
	return DGGBoundary.make([], [1])


func size() -> int:
	return heads.size()


func is_complete() -> bool:
	return heads.is_empty()


## A graph with exactly one half-edge. The paper calls these [i]stubs[/i] (§5.5) and
## they are the most useful graphs in a grammar: a stub can cap off any dangling
## half-edge of its label, so a grammar that owns both stubs of a label can take
## every edge with that label apart.
func is_stub() -> bool:
	return heads.size() == 1


func total_turn() -> int:
	var sum := 0
	for t in turns:
		sum += t
	return sum


func duplicate_boundary() -> DGGBoundary:
	var b := DGGBoundary.new()
	b.heads = heads.duplicate()
	b.turns = turns.duplicate()
	return b


## Returns this boundary re-cut so that walking starts at [code]heads[n][/code].
func rotated(n: int) -> DGGBoundary:
	var k := heads.size()
	if k == 0:
		return duplicate_boundary()
	n = posmod(n, k)
	if n == 0:
		return duplicate_boundary()
	var b := DGGBoundary.new()
	b.heads = PackedInt32Array()
	b.turns = PackedInt32Array()
	b.heads.resize(k)
	b.turns.resize(k)
	for i in k:
		b.heads[i] = heads[(i + n) % k]
		b.turns[i] = turns[(i + n) % k]
	return b


## A rotation-invariant string identity. Two boundaries are equal as cyclic words
## if and only if their canonical keys match.
func canonical_key() -> String:
	var k := heads.size()
	if k == 0:
		return "()%d" % turns[0]
	var best := ""
	for n in k:
		var s := ""
		for i in k:
			s += "%d,%d;" % [heads[(i + n) % k], turns[(i + n) % k]]
		if best == "" or s < best:
			best = s
	return best


func equals(other: DGGBoundary) -> bool:
	return canonical_key() == other.canonical_key()


func _to_string() -> String:
	var k := heads.size()
	if k == 0:
		return _turn_glyphs(turns[0])
	var s := ""
	for i in k:
		s += "h%d" % heads[i]
		s += _turn_glyphs(turns[i])
	return s


static func _turn_glyphs(t: int) -> String:
	if t == 0:
		return ""
	var glyph := "^" if t > 0 else "v"
	return glyph.repeat(absi(t))


# --- Gluing (§4.2) ------------------------------------------------------------
#
# Two half-edges a and ā can be glued back into one full edge. Which gluings are
# legal is decided entirely by the boundary string, because the string already
# encodes every angle the walk has turned through.

## Every position [code]m[/code] where [code]heads[m][/code] and
## [code]heads[m + 1][/code] can be loop glued, closing a face between them.
##
## Loop gluing joins two half-edges that are already on the same graph, so it
## creates a cycle. Two conditions decide legality.
##
## [b]Adjacency.[/b] The pair must be cyclically adjacent. Gluing seals the arc
## between them into a face, and anything caught inside would have no way out.
##
## [b]Curvature.[/b] A closed loop in a planar drawing turns exactly ±360°, which
## fixes the walk's turning between the pair at ±180°. Complementary half-edges
## are anti-parallel, so their reduced angles already differ by ±180; the net turn
## [code]w[/code] between them has to supply the rest and nothing more:
## [codeblock lang=text]
##   heads[m] negative (the paper's a):  reduced +180  →  w ∈ {0, -1}
##   heads[m] positive (the paper's ā):  reduced -180  →  w ∈ {0, +1}
## [/codeblock]
## The first row is exactly the paper's pair of rewrites, [code]a ā → ε[/code]
## (turning +360°) and [code]a ∨ ā ∧ → ε[/code] (turning -360°). The second row is
## the same rule read from the other end of the edge.
##
## This relies on bit 0 of a half-edge id being its sign, which is how
## [method DGGLabels.head_id] packs them.
func loop_glue_sites() -> PackedInt32Array:
	var sites := PackedInt32Array()
	var k := heads.size()
	if k < 2:
		return sites
	for m in k:
		var n := (m + 1) % k
		if not are_complementary(heads[m], heads[n]):
			continue
		var wrap := 1 if (heads[m] & 1) == 1 else -1
		if turns[m] == 0 or turns[m] == wrap:
			sites.append(m)
	return sites


## Applies a loop glue at the site returned by [method loop_glue_sites].
## Both half-edges leave the boundary and the turn slots around them merge, which
## conserves the total turn and so preserves the loops-once invariant.
func loop_glued(m: int) -> DGGBoundary:
	var k := heads.size()
	assert(k >= 2)
	var n := (m + 1) % k
	var b := DGGBoundary.new()
	b.heads = PackedInt32Array()
	b.turns = PackedInt32Array()
	if k == 2:
		b.turns.append(turns[0] + turns[1])
		return b
	# Walk the survivors starting just after the glued pair. The turn that used to
	# precede the pair absorbs both of the pair's turn slots.
	var start := (n + 1) % k
	var carried := turns[m] + turns[n]
	for i in k - 2:
		var idx := (start + i) % k
		b.heads.append(heads[idx])
		if i == k - 3:
			b.turns.append(turns[idx] + carried)
		else:
			b.turns.append(turns[idx])
	return b


## Branch gluing: joins two [i]separate[/i] graphs at one half-edge each.
##
## In the paper's notation the boundaries [code]B₁a[/code] and [code]āB₂[/code]
## combine into [code]B₁∨B₂[/code] — the two strings concatenate and a single
## negative turn appears at the seam. That extra [code]∨[/code] is what keeps the
## merged walk looping exactly once: 1 + 1 - 1 = 1.
##
## [param i] indexes a half-edge of this boundary, [param j] its complement in
## [param other]. The half-edge order of the result is B₁ then B₂, which is the
## order [method DGGGraph.branch_glued] relies on when it stitches the two graphs'
## spoke tables together.
func branch_glued(other: DGGBoundary, i: int, j: int) -> DGGBoundary:
	assert(are_complementary(heads[i], other.heads[j]), "half-edges must be complementary")
	var k1 := heads.size()
	var k2 := other.heads.size()
	# Lay the result out as a flat token stream, then fold it back into the
	# heads/turns pair. Going through tokens keeps the stub cases (k == 1, where a
	# graph contributes turns but no half-edges) from needing special handling.
	var tokens: Array = []  # [is_head, value]
	tokens.append([false, turns[i]])  # B₁ opens with the turn that followed a
	for n in k1 - 1:
		var idx := (i + 1 + n) % k1
		tokens.append([true, heads[idx]])
		tokens.append([false, turns[idx]])
	tokens.append([false, -1])  # the splice's ∨
	tokens.append([false, other.turns[j]])  # B₂ opens with the turn that followed ā
	for n in k2 - 1:
		var idx := (j + 1 + n) % k2
		tokens.append([true, other.heads[idx]])
		tokens.append([false, other.turns[idx]])
	return _from_tokens(tokens)


## Folds a cyclic token stream into a boundary. Turns preceding the first
## half-edge belong, cyclically, to the slot after the last one.
static func _from_tokens(tokens: Array) -> DGGBoundary:
	var b := DGGBoundary.new()
	b.heads = PackedInt32Array()
	b.turns = PackedInt32Array()
	var pending := 0
	var leading := 0
	var seen_head := false
	for tok in tokens:
		if tok[0]:
			if seen_head:
				b.turns.append(pending)
			else:
				leading = pending
				seen_head = true
			pending = 0
			b.heads.append(tok[1])
		else:
			pending += tok[1]
	if seen_head:
		b.turns.append(pending + leading)
	else:
		b.turns.append(pending)
	return b
