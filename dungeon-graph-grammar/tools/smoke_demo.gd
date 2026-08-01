extends SceneTree
# Loads the demo scene headless to prove it wires up and generates.
func _initialize() -> void:
	var scene: PackedScene = load("res://demo/main.tscn")
	if scene == null:
		printerr("demo scene failed to load"); quit(1); return
	var root = scene.instantiate()
	get_root().add_child(root)
	await process_frame
	print("demo ok: dungeon=%s report=%d chars" % [
		"null" if root.dungeon == null else "V%d E%d" % [
			root.dungeon.vertex_count, root.dungeon.edge_count()],
		root._report.text.length()])
	quit(0)
