extends SceneTree

## Command-line inspector. Loads an example, derives a grammar and prints what it
## found:
##
##     godot --headless --path . --script res://tools/inspect.gd -- examples/warren.json


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	var path: String = args[0] if args.size() > 0 else "examples/warren.json"
	if not path.begins_with("res://"):
		path = "res://" + path

	var t0 := Time.get_ticks_msec()
	var example := DGGExample.from_file(path)
	if example == null:
		quit(1)
		return
	print(example.summary())
	print("  built in %d ms" % (Time.get_ticks_msec() - t0))
	for i in example.primitives.size():
		print("    primitive %2d ×%-2d  %s" % [
			i, example.primitive_counts[i], str(example.primitives[i].boundary),
		])

	print("\n%s" % DGGFeasibility.analyse(example).summary())

	var grammar := DGGGrammar.from_example(example)
	if args.size() > 1:
		grammar.max_generations = int(args[1])
	t0 = Time.get_ticks_msec()
	grammar.build()
	print("\n%s" % grammar.summary())
	print("  built in %d ms" % (Time.get_ticks_msec() - t0))
	print("  stats: %s" % str(grammar.stats))
	var shown := 0
	for r in grammar.rules:
		if shown >= 20:
			print("    ... %d more" % (grammar.rules.size() - shown))
			break
		print("    %s" % r.describe())
		shown += 1
	quit(0)
