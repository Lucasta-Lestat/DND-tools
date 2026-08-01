@tool
class_name DGGSvg
extends RefCounted

## Renders a dungeon drawing to SVG, so results can be inspected without opening
## the editor and dropped straight into notes or a VTT.

const MARGIN := 24.0
const SCALE := 24.0
const DEFAULT_COLORS := [
	"#b7a181", "#7d8a99", "#9c7f6a", "#8fa07c", "#a08398", "#7f9aa0",
]


static func render(graph: DGGGraph, example: DGGExample = null) -> String:
	if graph.vertex_pos.size() < graph.vertex_count:
		return ""
	var lo := graph.vertex_pos[0]
	var hi := graph.vertex_pos[0]
	for p in graph.vertex_pos:
		lo = lo.min(p)
		hi = hi.max(p)
	var size := (hi - lo) * SCALE + Vector2.ONE * MARGIN * 2.0

	var body := PackedStringArray()
	body.append('<svg xmlns="http://www.w3.org/2000/svg" width="%.0f" height="%.0f" '
			% [size.x, size.y] + 'viewBox="0 0 %.0f %.0f">' % [size.x, size.y])
	body.append('<rect width="%.0f" height="%.0f" fill="#15161a"/>' % [size.x, size.y])

	var outer := graph.labels.face_id(example.outer_face) if example else -1
	for face in graph.trace_faces():
		var verts: PackedInt32Array = face["vertices"]
		if verts.size() < 3:
			continue
		var pts := PackedVector2Array()
		for v in verts:
			pts.append(_to_svg(graph.vertex_pos[v], lo))
		# trace_faces keeps each face on its right, so rooms come out clockwise
		# (negative area) and the unbounded outside counter-clockwise.
		if _signed_area(pts) >= 0.0:
			continue
		if face["label"] == outer:
			continue
		body.append('<polygon points="%s" fill="%s" fill-opacity="0.9"/>'
				% [_points(pts), _color(graph, example, face["label"])])

	var seen := {}
	for s in graph.spoke_count():
		var p: int = graph.spoke_partner[s]
		if p < 0 or seen.has(s):
			continue
		seen[s] = true
		seen[p] = true
		var a := _to_svg(graph.vertex_pos[graph.spoke_vertex[s]], lo)
		var b := _to_svg(graph.vertex_pos[graph.spoke_vertex[p]], lo)
		var edge := DGGLabels.head_edge(graph.spoke_head[s])
		if graph.labels.edge_is_passable(edge):
			# A doorway is drawn as a gap with a threshold, so a reader can see at a
			# glance which way a player could walk.
			body.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" '
					% [a.x, a.y, b.x, b.y]
					+ 'stroke="%s" stroke-width="2" stroke-dasharray="3 3"/>'
					% _kind_color(graph, example, edge))
			continue
		body.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" '
				% [a.x, a.y, b.x, b.y]
				+ 'stroke="#0d0e11" stroke-width="3" stroke-linecap="round"/>')
	body.append("</svg>")
	return "\n".join(body)


static func _to_svg(p: Vector2, lo: Vector2) -> Vector2:
	return (p - lo) * SCALE + Vector2.ONE * MARGIN


static func _points(pts: PackedVector2Array) -> String:
	var parts := PackedStringArray()
	for p in pts:
		parts.append("%.1f,%.1f" % [p.x, p.y])
	return " ".join(parts)


static func _signed_area(pts: PackedVector2Array) -> float:
	var a := 0.0
	for i in pts.size():
		var p := pts[i]
		var q := pts[(i + 1) % pts.size()]
		a += p.x * q.y - q.x * p.y
	return a * 0.5


static func _kind_color(graph: DGGGraph, example: DGGExample, edge: int) -> String:
	var name := graph.labels.kind_name(graph.labels.edge_kind(edge))
	if example and example.kind_colors.has(name):
		return str(example.kind_colors[name])
	return "#e8d9a0"


static func _color(graph: DGGGraph, example: DGGExample, face: int) -> String:
	var name := graph.labels.face_name(face)
	if example and example.face_colors.has(name):
		return str(example.face_colors[name])
	return DEFAULT_COLORS[face % DEFAULT_COLORS.size()]
