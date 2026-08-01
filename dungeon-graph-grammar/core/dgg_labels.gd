@tool
class_name DGGLabels
extends RefCounted

## The label alphabet shared by an example shape and everything derived from it.
##
## Local similarity (§3.1) is enforced entirely through labels. The paper takes
## r-similarity to its limit: the neighbourhood radius shrinks until each
## neighbourhood holds a single edge, vertex or face, so two edges are
## interchangeable exactly when their labels match.
##
## An edge label is the tuple [code]ã = (l, r, θ, kind)[/code] — the face on its
## left, the face on its right, its tangent angle, and what the wall is made of.
## [i]kind[/i] is how doors enter the model: a doorway is still a wall segment, so
## the faces stay well defined, but it carries a different kind and is therefore a
## different label. Local similarity then preserves door topology for free — the
## matcher will not swap a door for a solid wall any more than it would swap a
## horizontal wall for a vertical one. Angles are stored in
## [code][0°, 180°)[/code]; an edge and its reverse are the same edge, so the
## direction that would exceed 180° is folded back with [code]l[/code] and
## [code]r[/code] swapped.
##
## Cutting an edge yields two half-edges (§3.3). The one pointing along +θ is the
## paper's [code]ā[/code]; the one pointing along θ - 180° is [code]a[/code]. We
## pack them as [code]edge_id * 2 + positive[/code] so that complementary
## half-edges differ only in bit 0.

## Angular tolerance when interning a label. Two edges within this many degrees of
## each other are treated as the same angle, and so as locally interchangeable.
## Widen it to let a hand-drawn example generalise; narrow it to keep near-parallel
## walls distinct.
var angle_epsilon: float = 0.5

var face_names: PackedStringArray = PackedStringArray()
## Wall kinds. Index 0 is always [code]"wall"[/code]; doors and anything else an
## author invents are interned after it.
var kind_names: PackedStringArray = PackedStringArray(["wall"])
var _edge_left: PackedInt32Array = PackedInt32Array()
var _edge_right: PackedInt32Array = PackedInt32Array()
var _edge_angle: PackedFloat32Array = PackedFloat32Array()
var _edge_kind: PackedInt32Array = PackedInt32Array()

const KIND_WALL := 0


func face_id(name: String) -> int:
	var idx := face_names.find(name)
	if idx >= 0:
		return idx
	face_names.append(name)
	return face_names.size() - 1


func face_name(id: int) -> String:
	return face_names[id] if id >= 0 and id < face_names.size() else "?"


func edge_count() -> int:
	return _edge_angle.size()


func edge_left(id: int) -> int:
	return _edge_left[id]


func edge_right(id: int) -> int:
	return _edge_right[id]


func edge_angle(id: int) -> float:
	return _edge_angle[id]


func edge_kind(id: int) -> int:
	return _edge_kind[id]


func kind_id(name: String) -> int:
	var idx := kind_names.find(name)
	if idx >= 0:
		return idx
	kind_names.append(name)
	return kind_names.size() - 1


func kind_name(id: int) -> String:
	return kind_names[id] if id >= 0 and id < kind_names.size() else "?"


## True when this label is anything other than a solid wall, i.e. something a
## creature could pass through. Room adjacency is built out of these.
func edge_is_passable(id: int) -> bool:
	return _edge_kind[id] != KIND_WALL


## Interns the edge label for a segment travelling in [param direction_deg] with
## [param left] on its left. Returns the edge label id; the caller pairs it with a
## sign to get a half-edge.
func edge_id(left: int, right: int, direction_deg: float, kind: int = KIND_WALL) -> int:
	var theta := normalize_180(direction_deg)
	var l := left
	var r := right
	if theta < 0.0:
		# Fold the reverse direction back onto the canonical [0°, 180°) range.
		theta += 180.0
		l = right
		r = left
	if theta >= 180.0 - angle_epsilon and theta < 180.0:
		theta = 0.0  # 180° and 0° are the same undirected direction
		l = right
		r = left
	for i in _edge_angle.size():
		if _edge_left[i] == l and _edge_right[i] == r and _edge_kind[i] == kind \
				and absf(_edge_angle[i] - theta) <= angle_epsilon:
			return i
	_edge_left.append(l)
	_edge_right.append(r)
	_edge_angle.append(theta)
	_edge_kind.append(kind)
	return _edge_angle.size() - 1


## Builds the half-edge id for one end of an edge. [param positive] selects the
## half-edge pointing along +θ (the paper's [code]ā[/code]).
static func head_id(edge: int, positive: bool) -> int:
	return edge * 2 + (1 if positive else 0)


static func head_edge(head: int) -> int:
	return head >> 1


static func head_is_positive(head: int) -> bool:
	return (head & 1) == 1


## The outward direction of a half-edge, in [code][-180°, 180°)[/code].
func head_direction(head: int) -> float:
	var theta := _edge_angle[head >> 1]
	return theta if (head & 1) == 1 else normalize_180(theta - 180.0)


## The face lying to the left of the ray as it points [i]outward[/i] from its vertex.
func head_left_face(head: int) -> int:
	var e := head >> 1
	return _edge_left[e] if (head & 1) == 1 else _edge_right[e]


## The face lying to the right of the ray as it points outward from its vertex.
func head_right_face(head: int) -> int:
	var e := head >> 1
	return _edge_right[e] if (head & 1) == 1 else _edge_left[e]


func head_name(head: int) -> String:
	var e := head >> 1
	return "%s|%s@%.0f%s%s" % [
		face_name(_edge_left[e]), face_name(_edge_right[e]), _edge_angle[e],
		"" if _edge_kind[e] == KIND_WALL else " " + kind_name(_edge_kind[e]),
		"+" if (head & 1) == 1 else "-",
	]


## Interns the half-edge for a spoke leaving a vertex in [param direction_deg],
## with [param left_out] / [param right_out] naming the faces either side of that
## outward ray.
func spoke_head(left_out: int, right_out: int, direction_deg: float,
		kind: int = KIND_WALL) -> int:
	var dir := normalize_180(direction_deg)
	if dir < 0.0 and dir > -angle_epsilon:
		dir = 0.0  # just shy of due-east is due-east, and so a positive half-edge
	var positive := dir >= 0.0
	var edge := edge_id(left_out, right_out, dir, kind)
	return head_id(edge, positive)


static func normalize_180(deg: float) -> float:
	var d := fposmod(deg + 180.0, 360.0) - 180.0
	# fposmod can return exactly 180.0 for inputs at the seam; fold it down.
	if d >= 180.0:
		d -= 360.0
	return d
