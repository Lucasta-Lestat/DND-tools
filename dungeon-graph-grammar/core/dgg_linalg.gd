@tool
class_name DGGLinalg
extends RefCounted

## Dense solver for the small systems the drawing stage produces (§6.2).
##
## Fixing every edge's angle turns "where do the vertices go?" into a linear
## system [code]Ax = b[/code]. It is usually underdetermined — a corridor can be
## any length — and that slack is the point: the nullspace of [code]A[/code] is
## exactly the space of drawings consistent with the angle graph, and the drawing
## stage samples from it rather than optimising over it.
##
## Systems here are tens of rows at most, so plain Gauss-Jordan with partial
## pivoting is the right tool.

const EPS := 1e-9


## Inverts a small square matrix by Gauss-Jordan on [code][M | I][/code].
##
## Used to build a projector once per linear system rather than re-solving the
## normal equations for every sample: the matrix depends only on the nullspace
## basis, while the right-hand side changes with each proposed drawing.
## Returns an empty array if [param m] is singular.
static func invert(m: Array, n: int) -> Array:
	var aug: Array = []
	for i in n:
		var row := PackedFloat64Array()
		row.resize(n * 2)
		row.fill(0.0)
		var src: PackedFloat64Array = m[i]
		for j in n:
			row[j] = src[j]
		row[n + i] = 1.0
		aug.append(row)
	for c in n:
		var best := c
		var best_abs := absf(aug[c][c])
		for i in range(c + 1, n):
			var a := absf(aug[i][c])
			if a > best_abs:
				best_abs = a
				best = i
		if best_abs <= EPS:
			return []
		var tmp = aug[c]
		aug[c] = aug[best]
		aug[best] = tmp
		var pr: PackedFloat64Array = aug[c]
		var inv := 1.0 / pr[c]
		for j in n * 2:
			pr[j] *= inv
		for i in n:
			if i == c:
				continue
			var f: float = aug[i][c]
			if absf(f) <= EPS:
				continue
			var ri: PackedFloat64Array = aug[i]
			for j in n * 2:
				ri[j] -= f * pr[j]
	var out: Array = []
	for i in n:
		var row := PackedFloat64Array()
		row.resize(n)
		for j in n:
			row[j] = aug[i][n + j]
		out.append(row)
	return out


## Solves [code]Ax = b[/code].
##
## Returns [code]{ok, x, basis}[/code]. [code]x[/code] is one particular solution
## and [code]basis[/code] spans the nullspace, so every solution is
## [code]x + basis · Λ[/code] for arbitrary Λ. [code]ok[/code] is false when the
## system is inconsistent, which in context means the vertex positions are
## overconstrained and more of them need to be freed.
static func solve(rows: Array, rhs: PackedFloat64Array, n_cols: int) -> Dictionary:
	var m := rows.size()
	var aug: Array = []
	for i in m:
		var row := PackedFloat64Array()
		row.resize(n_cols + 1)
		var src: PackedFloat64Array = rows[i]
		for j in n_cols:
			row[j] = src[j]
		row[n_cols] = rhs[i]
		aug.append(row)

	var pivot_of_col := PackedInt32Array()
	pivot_of_col.resize(n_cols)
	pivot_of_col.fill(-1)
	var r := 0
	for c in n_cols:
		if r >= m:
			break
		# Partial pivoting: the largest magnitude in the column keeps the
		# elimination numerically calm.
		var best := r
		var best_abs := absf(aug[r][c])
		for i in range(r + 1, m):
			var a := absf(aug[i][c])
			if a > best_abs:
				best_abs = a
				best = i
		if best_abs <= EPS:
			continue
		var tmp = aug[r]
		aug[r] = aug[best]
		aug[best] = tmp
		var inv: float = 1.0 / aug[r][c]
		var pr: PackedFloat64Array = aug[r]
		for j in range(c, n_cols + 1):
			pr[j] *= inv
		for i in m:
			if i == r:
				continue
			var f: float = aug[i][c]
			if absf(f) <= EPS:
				continue
			var ri: PackedFloat64Array = aug[i]
			for j in range(c, n_cols + 1):
				ri[j] -= f * pr[j]
		pivot_of_col[c] = r
		r += 1

	# A row that reads 0 = nonzero means there is no solution at all.
	for i in range(r, m):
		if absf(aug[i][n_cols]) > 1e-6:
			return {"ok": false, "x": PackedFloat64Array(), "basis": []}

	var x := PackedFloat64Array()
	x.resize(n_cols)
	x.fill(0.0)
	for c in n_cols:
		if pivot_of_col[c] >= 0:
			x[c] = aug[pivot_of_col[c]][n_cols]

	var basis: Array = []
	for c in n_cols:
		if pivot_of_col[c] >= 0:
			continue
		var v := PackedFloat64Array()
		v.resize(n_cols)
		v.fill(0.0)
		v[c] = 1.0
		for p in n_cols:
			var pr_idx: int = pivot_of_col[p]
			if pr_idx >= 0:
				v[p] = -aug[pr_idx][c]
		basis.append(v)
	return {"ok": true, "x": x, "basis": basis}
