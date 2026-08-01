extends SceneTree

## Headless test runner.
##
##     godot --headless --path . --script res://tests/run_tests.gd

const SUITES := [
	"res://tests/test_boundary.gd",
	"res://tests/test_graph.gd",
	"res://tests/test_example.gd",
	"res://tests/test_grammar.gd",
	"res://tests/test_generator.gd",
]

var passed := 0
var failed := 0
var current := ""


func _initialize() -> void:
	var only := ""
	for arg in OS.get_cmdline_user_args():
		only = arg
	for path in SUITES:
		if only != "" and not path.contains(only):
			continue
		if not ResourceLoader.exists(path):
			continue
		var script: GDScript = load(path)
		var suite = script.new()
		suite.t = self
		print("\n── %s" % path.get_file())
		for method in suite.get_method_list():
			var name: String = method.name
			if not name.begins_with("test_"):
				continue
			current = name
			suite.call(name)
	print("\n%d passed, %d failed" % [passed, failed])
	quit(1 if failed > 0 else 0)


func ok(condition: bool, message: String) -> void:
	if condition:
		passed += 1
	else:
		failed += 1
		printerr("  FAIL  %s: %s" % [current, message])


func eq(actual, expected, message: String) -> void:
	if _same(actual, expected):
		passed += 1
	else:
		failed += 1
		printerr("  FAIL  %s: %s\n          expected %s\n          got      %s"
				% [current, message, str(expected), str(actual)])


func _same(a, b) -> bool:
	if a is PackedInt32Array or b is PackedInt32Array:
		return Array(a) == Array(b)
	return a == b
