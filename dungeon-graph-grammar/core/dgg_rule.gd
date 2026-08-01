@tool
class_name DGGRule
extends RefCounted

## One double-pushout production rule: [code]L → R[/code] (§5).
##
## [member left] is a single connected graph. [member right] is a [i]set[/i] of
## graphs, because a rule may split one graph into several simpler pieces — that
## is how the grammar takes cycles apart, and it is what lets these grammars
## generate loops that earlier inverse-modelling methods could not.
##
## The two sides always have the same boundary string. That is the whole reason a
## rule is safe to apply: identical boundaries mean identical half-edges and
## identical total curvature, so [member right] can be lifted out and
## [member left] dropped into the hole without disturbing planarity.
##
## DPO rules are invertible. By convention [member right] is the simpler side, so
## applying a rule forwards deconstructs a graph and applying it backwards builds
## one up. Generation (§6) uses both directions.
##
## A rule with an empty [member right] is a [b]starter rule[/b]: it creates a
## complete graph out of nothing, or deletes one back to nothing. Starter rules
## are the only rules that can fire on the empty start graph.

var left: DGGGraph
var right: Array[DGGGraph] = []
## For each half-edge position of [code]left.boundary[/code], which piece of
## [member right] carries it and at what position: [code]Vector2i(piece, index)[/code].
var seam: Array[Vector2i] = []
## Where this rule came from, for the inspector.
var note: String = ""


static func make(p_left: DGGGraph, p_right: Array[DGGGraph], p_seam: Array[Vector2i]) -> DGGRule:
	var r := DGGRule.new()
	r.left = p_left
	r.right = p_right
	r.seam = p_seam
	return r


static func starter(complete_graph: DGGGraph) -> DGGRule:
	var r := DGGRule.new()
	r.left = complete_graph
	r.right = []
	r.seam = []
	r.note = "starter"
	return r


func is_starter() -> bool:
	return right.is_empty()


## Half-edges on the boundary of either side. Both sides agree by construction.
func boundary_size() -> int:
	return left.boundary.size()


func describe() -> String:
	if is_starter():
		return "∅ → [V%d E%d]" % [left.vertex_count, left.edge_count()]
	var parts := PackedStringArray()
	for g in right:
		parts.append("V%d E%d" % [g.vertex_count, g.edge_count()])
	return "[V%d E%d ∂=%s] → {%s}" % [
		left.vertex_count, left.edge_count(), str(left.boundary), ", ".join(parts),
	]
