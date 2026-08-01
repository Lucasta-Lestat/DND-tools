extends Control

## Interactive front end: pick an example, derive its grammar, generate dungeons.
##
## The three panels follow the three parts of the method. The left column is the
## example and what it was cut into; the middle is the derived grammar; the right
## is the dungeon the grammar produced. Nothing here is authored by hand — the
## rule list is whatever the algorithm found.

const EXAMPLES := [
	"res://examples/cells.json",
	"res://examples/vaults.json",
	"res://examples/burrow.json",
	"res://examples/warren.json",
]

@onready var _example_picker: OptionButton = %ExamplePicker
@onready var _seed_field: SpinBox = %SeedField
@onready var _iterations_field: SpinBox = %IterationsField
@onready var _target_field: SpinBox = %TargetField
@onready var _generations_field: SpinBox = %GenerationsField
@onready var _report: RichTextLabel = %Report
@onready var _view: Control = %View
@onready var _generate_button: Button = %GenerateButton

var example: DGGExample
var grammar: DGGGrammar
var dungeon: DGGGraph
var _feasibility: DGGFeasibility
var _grammar_source := ""


func _ready() -> void:
	for path in EXAMPLES:
		_example_picker.add_item(path.get_file().get_basename())
	_example_picker.item_selected.connect(func(_i): _regenerate())
	_generate_button.pressed.connect(_regenerate)
	%RerollButton.pressed.connect(func():
		_seed_field.value = randi() % 100000
		_regenerate())
	%ExportButton.pressed.connect(_export_svg)
	_view.draw.connect(_draw_view)
	_regenerate()


func _regenerate() -> void:
	var path: String = EXAMPLES[_example_picker.selected]
	example = DGGExample.from_file(path)
	if example == null:
		_report.text = "[color=#e08]could not load %s[/color]" % path
		return

	_feasibility = DGGFeasibility.analyse(example)

	# Deriving the grammar is the expensive half, so only redo it when the example
	# or the search depth actually changed.
	var key := "%s|%d" % [path, int(_generations_field.value)]
	if key != _grammar_source:
		grammar = DGGGrammar.from_example(example)
		grammar.max_generations = int(_generations_field.value)
		grammar.build()
		_grammar_source = key

	var generator := DGGGenerator.new(grammar, int(_seed_field.value))
	generator.configure_lengths(example.min_edge_length, example.max_edge_length)
	generator.target_vertices = int(_target_field.value)
	dungeon = generator.generate(int(_iterations_field.value))
	_write_report(generator)
	_view.queue_redraw()


func _write_report(generator: DGGGenerator) -> void:
	var lines := PackedStringArray()
	lines.append("[b]Example[/b]  %s" % example.summary().replace("\n", "\n  "))
	lines.append("")
	lines.append("[b]Reachable[/b]  %s" % _feasibility.summary().replace("\n", "\n"))
	lines.append("")
	lines.append("[b]Grammar[/b]  %d rules, %d graphs in the hierarchy%s"
			% [grammar.rules.size(), grammar.hierarchy.size(),
			"" if grammar.exhausted else " (search bounded)"])
	lines.append("  %d starter · %d splitting · %d stubs" % [
			grammar.stats.get("starter_rules", 0),
			grammar.stats.get("splitting_rules", 0),
			grammar.stats.get("stubs", 0)])
	var shown := 0
	for rule in grammar.rules:
		if shown >= 12:
			lines.append("  … and %d more" % (grammar.rules.size() - shown))
			break
		lines.append("  %s" % rule.describe())
		shown += 1
	lines.append("")
	if dungeon == null:
		lines.append("[color=#e08]No starter rule produced a drawable shape.[/color]")
	else:
		lines.append("[b]Dungeon[/b]  %d vertices, %d edges, %d rooms"
				% [dungeon.vertex_count, dungeon.edge_count(),
				_room_count()])
		lines.append("  %d of %d proposals accepted (%d unplaceable, %d disconnected, "
				% [generator.accepted, generator.accepted + generator.rejected,
				generator.unmatched, generator.disconnected]
				+ "%d non-planar, %d unrealisable, %d undrawable)"
				% [generator.nonplanar, generator.unrealisable, generator.undrawable])
	_report.text = "\n".join(lines)


func _room_count() -> int:
	var outer := example.labels.face_id(example.outer_face)
	var n := 0
	for face in dungeon.trace_faces():
		if face["label"] != outer and _area(face["vertices"]) < 0.0:
			n += 1
	return n


func _area(verts: PackedInt32Array) -> float:
	var a := 0.0
	for i in verts.size():
		var p := dungeon.vertex_pos[verts[i]]
		var q := dungeon.vertex_pos[verts[(i + 1) % verts.size()]]
		a += p.x * q.y - q.x * p.y
	return a * 0.5


# --- Drawing ------------------------------------------------------------------

func _draw_view() -> void:
	if dungeon == null or dungeon.vertex_pos.size() < dungeon.vertex_count:
		return
	var lo := dungeon.vertex_pos[0]
	var hi := dungeon.vertex_pos[0]
	for p in dungeon.vertex_pos:
		lo = lo.min(p)
		hi = hi.max(p)
	var span := (hi - lo)
	var margin := 24.0
	var area := _view.size - Vector2.ONE * margin * 2.0
	var scale := minf(area.x / maxf(span.x, 0.001), area.y / maxf(span.y, 0.001))
	scale = minf(scale, 64.0)
	var offset := Vector2.ONE * margin + (area - span * scale) * 0.5

	_view.draw_rect(Rect2(Vector2.ZERO, _view.size), Color("#15161a"))
	var outer := example.labels.face_id(example.outer_face)
	for face in dungeon.trace_faces():
		var verts: PackedInt32Array = face["vertices"]
		if verts.size() < 3 or face["label"] == outer or _area(verts) >= 0.0:
			continue
		var pts := PackedVector2Array()
		for v in verts:
			pts.append((dungeon.vertex_pos[v] - lo) * scale + offset)
		_view.draw_colored_polygon(pts, _face_color(face["label"]))
	var seen := {}
	for s in dungeon.spoke_count():
		var p: int = dungeon.spoke_partner[s]
		if p < 0 or seen.has(s):
			continue
		seen[s] = true
		seen[p] = true
		var a := (dungeon.vertex_pos[dungeon.spoke_vertex[s]] - lo) * scale + offset
		var b := (dungeon.vertex_pos[dungeon.spoke_vertex[p]] - lo) * scale + offset
		_view.draw_line(a, b, Color("#0d0e11"), 3.0)


func _face_color(face: int) -> Color:
	var name := example.labels.face_name(face)
	if example.face_colors.has(name):
		return Color(str(example.face_colors[name]))
	return Color.from_hsv(fmod(face * 0.17, 1.0), 0.28, 0.72)


func _export_svg() -> void:
	if dungeon == null:
		return
	var path := "user://%s_%d.svg" % [example.name, int(_seed_field.value)]
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		return
	f.store_string(DGGSvg.render(dungeon, example))
	f.close()
	_report.text += "\n\n[color=#8b8]wrote %s[/color]" % ProjectSettings.globalize_path(path)
