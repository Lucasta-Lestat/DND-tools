extends RefCounted

## Checks the boundary-string algebra of §3.3 and §4.2 against the worked examples
## printed in the paper.

var t

# Symbolic half-edges. Complementary pairs differ in bit 0, matching DGGLabels.
const A := 0
const A_BAR := 1
const B := 2
const B_BAR := 3
const X := 4
const X_BAR := 5
const Y := 6
const Y_BAR := 7


func test_loops_once() -> void:
	var b := DGGBoundary.make([Y, B, A], [1, 0, 0])
	t.eq(b.total_turn(), 1, "P - N = 1 for any boundary")
	t.ok(not b.is_complete(), "a boundary with half-edges is incomplete")
	t.ok(DGGBoundary.complete().is_complete(), "∂G = ∧ means complete")


func test_rotation_is_identity() -> void:
	# y∧ba = ∧bay = bay∧ — the walk is a loop, so where it starts is arbitrary.
	var b := DGGBoundary.make([Y, B, A], [1, 0, 0])
	t.eq(b.rotated(1).canonical_key(), b.canonical_key(), "rotation preserves identity")
	t.eq(b.rotated(2).canonical_key(), b.canonical_key(), "rotation preserves identity")
	var other := DGGBoundary.make([B, A, Y], [0, 0, 1])
	t.ok(b.equals(other), "the same cyclic word compares equal")
	var different := DGGBoundary.make([B, Y, A], [0, 0, 1])
	t.ok(not b.equals(different), "reordered half-edges are a different boundary")


func test_branch_glue_matches_paper_figure_3() -> void:
	# Figure 3c: ∂G₁ = y∧ba and ∂G₂ = ā∧xy glue into ∂G₃ = y∧bxy.
	var g1 := DGGBoundary.make([Y, B, A], [1, 0, 0])
	var g2 := DGGBoundary.make([A_BAR, X, Y], [1, 0, 0])
	var g3 := g1.branch_glued(g2, 2, 0)
	t.eq(Array(g3.heads), [Y, B, X, Y], "half-edges of B₁ then B₂ survive")
	t.eq(Array(g3.turns), [1, 0, 0, 0], "the splice's ∨ cancels ∂G₂'s leading ∧")
	t.eq(g3.total_turn(), 1, "gluing preserves the loops-once invariant")


func test_branch_glue_of_two_stubs() -> void:
	# Two stubs a∧ and ā∧ glue into a single complete edge graph.
	var s1 := DGGBoundary.make([A], [1])
	var s2 := DGGBoundary.make([A_BAR], [1])
	var glued := s1.branch_glued(s2, 0, 0)
	t.ok(glued.is_complete(), "a∧ + ā∧ closes up")
	t.eq(glued.total_turn(), 1, "still loops once")


func test_loop_glue_positive_case() -> void:
	# a ā → ε: the enclosed path turns +360°, so the substring vanishes outright.
	var b := DGGBoundary.make([A, A_BAR], [0, 1])
	var sites := b.loop_glue_sites()
	# With only two half-edges left the pair is adjacent both ways round, so both
	# readings show up. They join the same two spokes and give the same result.
	t.eq(Array(sites), [0, 1], "the adjacent complementary pair is gluable")
	t.ok(b.loop_glued(0).is_complete(), "gluing it completes the graph")
	t.ok(b.loop_glued(1).equals(b.loop_glued(0)), "and both readings agree")


func test_loop_glue_negative_case() -> void:
	# a ∨ ā ∧ → ε: the enclosed path turns -360° instead.
	var b := DGGBoundary.make([A_BAR, A], [2, -1])
	var sites := b.loop_glue_sites()
	t.eq(Array(sites), [1], "only the pair with net turn -1 is gluable")
	t.ok(b.loop_glued(1).is_complete(), "gluing it completes the graph")


func test_loop_glue_rejects_wrong_curvature() -> void:
	# The same two half-edges, but now the walk spirals: +720° one way round and
	# -540° the other. A planar closed loop turns ±360° and nothing else, so
	# neither position is gluable.
	var b := DGGBoundary.make([A, A_BAR], [2, -1])
	t.eq(Array(b.loop_glue_sites()), [], "an over-wound pair cannot close")
	var c := DGGBoundary.make([A, B], [0, 1])
	t.eq(Array(c.loop_glue_sites()), [], "non-complementary half-edges never glue")


func test_loop_glue_is_symmetric_in_the_pair() -> void:
	# The rule the paper writes as a ā → ε read from the other end of the edge:
	# with ā leading, the net turn that closes a face is +1 rather than -1.
	var b := DGGBoundary.make([A_BAR, A], [0, 1])
	t.eq(Array(b.loop_glue_sites()), [0], "ā a with net turn 0 closes a face")
	t.ok(b.loop_glued(0).is_complete(), "and completes the graph")


func test_loop_glue_keeps_remaining_half_edges() -> void:
	var b := DGGBoundary.make([X, A, A_BAR, Y], [0, 0, 0, 1])
	t.eq(Array(b.loop_glue_sites()), [1], "only the a/ā pair is gluable")
	var g := b.loop_glued(1)
	t.eq(Array(g.heads), [Y, X], "survivors keep their cyclic order")
	t.eq(g.total_turn(), 1, "still loops once")
	t.ok(g.equals(DGGBoundary.make([X, Y], [0, 1])), "and are cyclically unchanged")
