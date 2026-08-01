@tool
class_name DGGGoals
extends RefCounted

## What the author wants, over and above local similarity.
##
## The grammar guarantees every junction comes from the example and nothing else,
## so global shape drifts freely. This is where a designer says what the drift
## should aim at. Three mechanisms, and picking the right one matters more than
## the numbers:
##
## [b]Soft targets[/b] steer the walk through the Metropolis filter of §6.3
## requirement 4. A step towards the target is always taken; a step away is taken
## with a probability that falls off with how far it sets you back. Use these for
## anything you want [i]roughly[/i] — size, room count, how loopy it is.
##
## [b]Hard requirements[/b] reject outright. Use them only for things that would
## make the output useless — rooms you cannot reach, a dungeon in two halves.
## They multiply: two requirements that each pass a third of proposals leave you
## with a ninth, and if their feasible sets happen not to overlap the walk churns
## forever without ever saying so.
##
## [b]Proposal bias[/b] is the cheapest and least appreciated. Every rule has a
## fixed effect on vertex, edge, door and room counts, known before the run
## starts — a rule cannot sometimes add a room and sometimes remove one. So
## instead of proposing blindly and throwing away what does not help, the
## generator can favour rules whose effect points at the target. That improves
## the proposals rather than the rejections, which is worth far more.
##
## Anything non-linear — how loopy the room graph is, whether it is connected —
## cannot be predicted from a rule and only works as a soft target or a hard
## requirement.

## Rough vertex count to steer towards. 0 leaves size alone.
var target_vertices: int = 0
## Rough room count. 0 leaves it alone.
var target_rooms: int = 0
## Rough number of doorways between rooms. 0 leaves it alone.
var target_doors: int = 0
## Rough number of independent loops in the room-adjacency graph: 0 for a tree,
## 1 for a single circuit, more for a braid. -1 leaves it alone.
var target_loops: int = -1

## Reject any dungeon whose rooms are not all mutually reachable through doorways.
var require_single_region: bool = false
## Reject any dungeon with rooms you cannot get to from outside.
var require_all_reachable: bool = false
## Reject any dungeon with fewer than this many ways in. 0 disables the check.
var min_entrances: int = 0

## Relative pull of each soft target.
var weight_vertices: float = 1.0
var weight_rooms: float = 1.0
var weight_doors: float = 1.0
var weight_loops: float = 2.0
## How strongly rule selection leans on a rule's predicted effect. 0 disables the
## bias and leaves proposals uniform.
var proposal_bias: float = 1.5


## True when anything here needs the room-adjacency graph, which is the expensive
## measurement. Lets the generator skip it entirely when nothing asks for it.
func needs_topology() -> bool:
	return target_rooms > 0 or target_doors > 0 or target_loops >= 0 \
			or require_single_region or require_all_reachable or min_entrances > 0


func is_active() -> bool:
	return target_vertices > 0 or needs_topology()


## Whether a dungeon is acceptable at all, regardless of how good it is.
func permits(topology: DGGTopology) -> bool:
	if topology == null:
		return true
	if require_single_region and topology.region_count > 1:
		return false
	if require_all_reachable and topology.reachable_count < topology.room_count:
		return false
	if min_entrances > 0 and topology.entrance_count < min_entrances:
		return false
	return true


## How far a dungeon is from what was asked for. Lower is better; 0 is on target.
func cost(graph: DGGGraph, topology: DGGTopology) -> float:
	var total := 0.0
	if target_vertices > 0:
		total += weight_vertices * absf(graph.vertex_count - target_vertices)
	if topology == null:
		return total
	if target_rooms > 0:
		total += weight_rooms * absf(topology.room_count - target_rooms)
	if target_doors > 0:
		total += weight_doors * absf(topology.door_count - target_doors)
	if target_loops >= 0:
		total += weight_loops * absf(topology.loop_count - target_loops)
	return total


## How well a rule's known effect points at the targets, as a multiplier on how
## often it gets proposed.
##
## Only the quantities a rule can predict are used. Room count is one of them:
## Euler's formula fixes the bounded-face count at [code]E - V + 1[/code], so a
## rule that adds two edges and one vertex adds exactly one room, every time, on
## every dungeon. Loopiness is not — whether a new doorway joins two rooms that
## were already connected depends on where it lands — so it steers only through
## [method cost].
func rule_affinity(delta: Dictionary, graph: DGGGraph, topology: DGGTopology) -> float:
	if proposal_bias <= 0.0:
		return 1.0
	var alignment := 0.0
	if target_vertices > 0:
		alignment += weight_vertices * _points_towards(
				int(delta["vertices"]), graph.vertex_count, target_vertices)
	if topology != null:
		if target_rooms > 0:
			alignment += weight_rooms * _points_towards(
					int(delta["rooms"]), topology.room_count, target_rooms)
		if target_doors > 0:
			alignment += weight_doors * _points_towards(
					int(delta["doors"]), topology.door_count, target_doors)
	return exp(proposal_bias * alignment)


## +1 when the change moves towards the target, -1 when away, 0 when it does
## nothing or the target is already met.
static func _points_towards(change: int, current: int, target: int) -> float:
	if change == 0 or current == target:
		return 0.0
	return 1.0 if signi(change) == signi(target - current) else -1.0


func summary() -> String:
	var parts := PackedStringArray()
	if target_vertices > 0:
		parts.append("~%d vertices" % target_vertices)
	if target_rooms > 0:
		parts.append("~%d rooms" % target_rooms)
	if target_doors > 0:
		parts.append("~%d doorways" % target_doors)
	if target_loops >= 0:
		parts.append("~%d loop(s)" % target_loops)
	if require_single_region:
		parts.append("all rooms connected")
	if require_all_reachable:
		parts.append("all rooms reachable")
	if min_entrances > 0:
		parts.append("at least %d entrance(s)" % min_entrances)
	return "goals: %s" % ("none" if parts.is_empty() else ", ".join(parts))
