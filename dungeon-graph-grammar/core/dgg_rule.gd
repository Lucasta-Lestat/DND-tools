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

var _delta_cache: Dictionary = {}


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


## What applying this rule does to the counts a goal can name — fixed, and known
## before any dungeon exists.
##
## A rule swaps one side for the other and reconnects through the same sockets, so
## the socket edges cancel and only the sides' own vertices and internal edges
## move the totals. Room count follows from Euler: the bounded-face count of a
## connected plane graph is [code]E - V + 1[/code], so the change in rooms is just
## the change in edges minus the change in vertices. (That counts sealed rock
## pockets as rooms, so it is a good steer rather than an exact promise.)
##
## [param backwards] applies [code]R → L[/code], which is the growing direction.
func delta(backwards: bool) -> Dictionary:
	var key := 1 if backwards else 0
	if _delta_cache.has(key):
		return _delta_cache[key]
	var right_vertices := 0
	var right_edges := 0
	var right_doors := 0
	for piece in right:
		right_vertices += piece.vertex_count
		right_edges += piece.edge_count()
		right_doors += piece.passable_edge_count()
	var d_vertices := right_vertices - left.vertex_count
	var d_edges := right_edges - left.edge_count()
	var d_doors := right_doors - left.passable_edge_count()
	if backwards:
		d_vertices = -d_vertices
		d_edges = -d_edges
		d_doors = -d_doors
	var out := {
		"vertices": d_vertices,
		"edges": d_edges,
		"doors": d_doors,
		"rooms": d_edges - d_vertices,
	}
	_delta_cache[key] = out
	return out


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
