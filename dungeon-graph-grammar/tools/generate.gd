extends SceneTree

## Headless generator. Derives a grammar from an example, generates a dungeon and
## writes it out as SVG.
##
##     godot --headless --path . --script res://tools/generate.gd -- \
##         examples/warren.json out.svg --seed 7 --iterations 400 --generations 3


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	var path := "examples/warren.json"
	var out_path := "user://dungeon.svg"
	var seed := 1
	var iterations := 300
	var generations := 3
	var target := 0
	var positional: Array[String] = []
	var i := 0
	while i < args.size():
		var a: String = args[i]
		match a:
			"--seed": seed = int(args[i + 1]); i += 1
			"--iterations": iterations = int(args[i + 1]); i += 1
			"--generations": generations = int(args[i + 1]); i += 1
			"--target": target = int(args[i + 1]); i += 1
			_: positional.append(a)
		i += 1
	if positional.size() > 0:
		path = positional[0]
	if positional.size() > 1:
		out_path = positional[1]
	if not path.begins_with("res://"):
		path = "res://" + path

	var example := DGGExample.from_file(path)
	if example == null:
		quit(1)
		return
	print(example.summary())

	var grammar := DGGGrammar.from_example(example)
	grammar.max_generations = generations
	var t0 := Time.get_ticks_msec()
	grammar.build()
	print("%s\n  grammar in %d ms" % [grammar.summary(), Time.get_ticks_msec() - t0])

	var generator := DGGGenerator.new(grammar, seed)
	generator.configure_lengths(example.min_edge_length, example.max_edge_length)
	generator.target_vertices = target
	t0 = Time.get_ticks_msec()
	var dungeon := generator.generate(iterations)
	if dungeon == null:
		printerr("generation failed: no starter rule produced a drawable shape")
		quit(1)
		return
	print("dungeon: %d vertices, %d edges (%d proposals accepted, %d rejected) in %d ms" % [
		dungeon.vertex_count, dungeon.edge_count(),
		generator.accepted, generator.rejected, Time.get_ticks_msec() - t0,
	])
	print("  rejected: %d unplaceable, %d non-planar, %d undrawable"
			% [generator.unmatched, generator.nonplanar, generator.undrawable])
	for why in generator.failure_reasons:
		print("    %5d  %s" % [generator.failure_reasons[why], why])

	var svg := DGGSvg.render(dungeon, example)
	var f := FileAccess.open(out_path, FileAccess.WRITE)
	if f == null:
		printerr("cannot write %s" % out_path)
		quit(1)
		return
	f.store_string(svg)
	f.close()
	print("wrote %s" % ProjectSettings.globalize_path(out_path))
	quit(0)
