# Dungeon Graph Grammar

Procedural dungeons for Godot 4, built by **deriving a graph grammar from an
example floorplan** instead of writing generation rules by hand.

This is an implementation of the 2D half of Paul Merrell's
[*Example-Based Procedural Modeling Using Graph Grammars*](https://paulmerrell.org/wp-content/uploads/2023/08/ProcModelUsingGraphGram.pdf)
(ACM TOG 42(4), SIGGRAPH 2023) — the work behind the EPC 2024 talk *Beyond Wave
Function Collapse: Procedural Modeling without Tiles*. Section numbers throughout
the code refer to that paper.

You draw one dungeon. The tool works out the rules that could have produced it,
then uses those rules to produce different dungeons that are **locally similar**:
every corner, wall and junction in the output appears somewhere in your example,
but the large-scale layout is new.

There is no grid and there are no tiles.

![A dungeon generated from the two-room `cells` example](docs/sample.svg)

*Two rooms in, nineteen out. Every corner in the output is a corner that appears
in the example; the layout is not.*

---

## Why this rather than Wave Function Collapse

WFC and its relatives need the world quantised into cells. That grid is not an
implementation detail — it is load-bearing, and it caps what the output can look
like. Merrell's method drops it. Rooms can be any size, walls can meet at any
angle you used in the example, and corridors can be any length within a range you
choose.

The hard part it solves is **cycles**. Growing a tree-shaped dungeon is easy: when
you run out of ideas, cap the branch with a dead end. Closing a loop is not — the
path has to come back and meet itself at exactly the right place, and earlier
inverse-modelling methods either avoided loops or copied the input almost
verbatim. Loops are most of what makes a dungeon interesting, so this is the part
worth having.

## How it works

```
example floorplan  →  primitives  →  hierarchy  →  grammar  →  angle graph  →  drawing
      §3                  §4.1         §4.3        §5          §6.1            §6.2
```

**1. Label everything (§3.3).** The floorplan becomes a plane graph. Each wall is
labelled with the face on its left, the face on its right, and its angle. Two
walls are interchangeable exactly when those three things match — that is local
similarity taken to its limit.

**2. Cut it into primitives (§4.1).** Every wall is severed, leaving one piece per
vertex: a junction with its walls sticking out as *half-edges*. These are the only
building blocks; anything reassembled from them is locally similar to the example
by construction.

**3. The boundary string (§3.3).** Each piece carries a compact description of its
open edges — which half-edges the boundary walk crosses, and how far the walk
turns between them. Almost everything reduces to string algebra on these:

| operation | meaning |
|---|---|
| `a ā → ε` | join two half-edges, closing a face |
| `B₁a` + `āB₂` → `B₁∨B₂` | join two separate pieces |
| `∂G = ∧` | nothing left to glue; the shape is finished |

**4. The hierarchy and the grammar (§4.3, §5).** Glue pieces together in every
possible way, generation by generation. Whenever a new graph's boundary can be
rebuilt out of simpler graphs already seen, that pairing becomes a production
rule and the graph is dropped — everything below it in the hierarchy is covered by
the same rule. What survives gets expanded further.

**5. Generate (§6).** Rules are double-pushout rules, so they run in both
directions: forwards they take a dungeon apart, backwards they build one up.
Starting from the example, the generator keeps rewriting. Every intermediate state
is a finished dungeon, so it can be stopped anywhere.

**6. Draw it (§6.2).** The grammar produces angles, not coordinates. Fixed angles
make the geometry linear: each wall says `p₁ - p₀ = s·(cos θ, sin θ)`. The system
is underdetermined, and that slack is the space of valid drawings — the layout
samples it and rejects samples with walls out of range or walls that cross.

## Try it

Open the project in Godot 4.3+ and run it. Pick an example, press **Generate**,
press **New seed**.

Headless:

```bash
# derive a grammar and generate a dungeon, writing an SVG
godot --headless --path . --script res://tools/generate.gd -- \
    examples/cells.json out.svg --seed 21 --iterations 300 --target 40

# inspect the primitives and rules found for an example
godot --headless --path . --script res://tools/inspect.gd -- examples/cells.json 3

# tests
godot --headless --path . --script res://tests/run_tests.gd
```

## Authoring an example

Rooms are polygons. Anything a polygon does not border is the outer face.

```json
{
  "name": "cells",
  "outer_face": "rock",
  "edge_length": {"min": 2.0, "max": 6.0},
  "rooms": [
    {"label": "cell", "color": "#c8b48c", "polygon": [[0,0],[2,0],[2,2],[0,2]]},
    {"label": "cell", "color": "#c8b48c", "polygon": [[2,0],[4,0],[4,2],[2,2]]}
  ]
}
```

- Winding does not matter; clockwise rooms are rewound.
- Walls are split automatically where another room's corner lands in the middle
  of them, so a long hall backing onto two short cells is fine as written.
- `edge_length` should **bracket the lengths in your example with slack on both
  sides**. Set the minimum equal to your shortest wall and almost every rewrite
  becomes undrawable, because there is no room left to flex.
- Repetition is what generalises. An example where every junction is unique can
  only reproduce itself; the more a junction type recurs, the more the grammar can
  do with it.
- `angle_epsilon` (default 0.5°) sets how close two walls must be in angle to
  count as the same label. Widen it to make a hand-drawn example generalise more.

## What works, and what does not

The grammar derivation is the part this repository implements properly. It is
tested against the worked examples in the paper — the Figure 3 gluing, the
`a ā → ε` / `a ∨ ā ∧ → ε` rewrites, boundary-preservation and simplicity of every
derived rule, and the local-similarity guarantee on both the hierarchy and the
output. `examples/cells.json` grows from two rooms into chains of twenty-odd
rooms with correct labels, angles and planarity.

**Generation is weaker than the paper's.** Applying a rule means finding its
source side inside the current dungeon and swapping in the other side. A rule
guarantees the two sides present the same boundary, but *not* that the pieces were
sitting in the dungeon in the arrangement the rule assumed — nested the wrong way
round, or on opposite sides of a corridor. Those splices produce a graph that does
not embed in the plane, and are caught after the fact by Euler's formula
(`V - E + F = 2`) rather than avoided in advance. On dense, highly regular examples
such as `vaults.json` and `warren.json` the valid arrangements are rare enough that
the walk stalls at the starting shape.

The fix is to verify the arrangement while matching — walk the hole the cut would
leave and require the sockets to come round in the order the rule's boundary
string prescribes — and to enumerate placements in that order rather than
sampling them. `DGGGenerator._all_placements` is where that belongs.

Also not implemented: the §7 extension to 3D, and the §5.6 test for graphs with no
complete descendants (the hierarchy is bounded by size instead, which §5.7 allows
but which costs the guarantee that the grammar reaches *every* locally similar
shape).

## Layout

```
core/
  dgg_boundary.gd    boundary strings and the gluing algebra          §3.3, §4.2
  dgg_labels.gd      the face/edge/half-edge alphabet                 §3.3
  dgg_graph.gd       plane graphs as rotation systems; gluing         §4
  dgg_example.gd     room polygons → plane graph → primitives         §4.1
  dgg_rule.gd        one double-pushout production rule               §5
  dgg_grammar.gd     hierarchy construction and rule discovery        §5, Alg. 1–2
  dgg_generator.gd   the random walk over locally similar shapes      §6.1, Alg. 3
  dgg_layout.gd      angle graph → drawing                            §6.2–§6.3
  dgg_linalg.gd      dense solver with nullspace                      §6.2
  dgg_svg.gd         SVG output
demo/                the interactive front end
tools/               headless generate / inspect / smoke test
tests/               headless test suite
examples/            example floorplans
```

## Reference

- Paul Merrell. *Example-Based Procedural Modeling Using Graph Grammars.* ACM
  Transactions on Graphics 42(4), 2023. [PDF](https://paulmerrell.org/wp-content/uploads/2023/08/ProcModelUsingGraphGram.pdf) ·
  [project page](https://paulmerrell.org/grammar/)
- Paul Merrell. *Technical Companion to Example-Based Procedural Modeling Using
  Graph Grammars.* [arXiv:2309.00275](https://arxiv.org/abs/2309.00275)
- Merrell's own reference implementation, with plugins for Unity, Unreal and
  Godot: [merrell42/Procedural-Modeling-Using-Graph-Grammars](https://github.com/merrell42/Procedural-Modeling-Using-Graph-Grammars)

This implementation is independent, written from the paper. It is not affiliated
with or endorsed by the author.

## Licence

MIT — see [LICENSE](LICENSE).
