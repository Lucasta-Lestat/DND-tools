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

# what could a perfect generator ever do with this grammar?
godot --headless --path . --script res://tools/ceiling.gd -- vaults 5

# which label ratios are reachable at all
godot --headless --path . --script res://tools/label_conservation.gd

# tests
godot --headless --path . --script res://tests/run_tests.gd
```

`generate.gd` takes `--seed`, `--iterations`, `--generations`, `--hierarchy` (the
cap on stored graphs during rule discovery) and the goal flags `--target`
(vertices), `--rooms`, `--loops` and `--connected`.

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

### Doorways

Rooms are sealed until you cut a way through. A doorway is a stretch of an
existing wall, given by its two endpoints; the loader splits the wall at them for
you.

```json
"doors": [
  {"from": [2, 0.6], "to": [2, 1.4], "color": "#e8d9a0"}
]
```

A doorway is still a wall segment — the faces stay well defined — but it carries a
different *kind*, and kind is part of the label. That is the whole trick: because
labels **are** the similarity relation, the matcher will no more swap a doorway
for a solid wall than it would swap a horizontal wall for a vertical one. Door
topology is preserved by the same mechanism that preserves everything else, with
no special-casing anywhere in the grammar.

Doorways are also what make the room-adjacency graph exist, and that is where
almost every question a designer actually asks lives. See below.

### Anchored rooms

Mark a room `"anchor": true` and its corners are pinned. A pinned corner is never
matched by a rule, so it is never cut out, and any wall running between two
pinned corners survives every rewrite. The layout stage will not move it either.

```json
{"label": "vault", "anchor": true, "polygon": [[4,0],[6,0],[6,2],[4,2]]}
```

This is the "I drew the boss chamber by hand, generate the rest" case. In
`examples/sanctum.json` the vault comes out byte-identical across every seed
while the dungeon around it grows from 14 vertices to 40.

## Constraining the output

Local similarity is a promise about every junction and nothing else, so global
structure drifts. Generating from the two-room `cells` example gives a dungeon
with 19 holes; the input has 2. That is not a bug — every corner is still a
corner from the example — but "locally similar" and "what I wanted" are different
things, and the gap is where a user needs control.

### Say what you want

`DGGGoals` carries the targets. Three mechanisms, and picking the right one
matters more than the numbers:

| mechanism | what it is for | example |
|---|---|---|
| **soft target** | anything you want *roughly* | `target_rooms`, `target_loops` |
| **hard requirement** | things that make the output useless if violated | `require_all_reachable` |
| **proposal bias** | making the walk propose useful moves in the first place | automatic |

The third is the one worth knowing about. Every rule has a **fixed** effect on
vertex, edge, doorway and room counts, known before the run starts — a rule cannot
sometimes add a room and sometimes remove one. Room count follows from Euler:
the bounded-face count of a connected plane graph is `E − V + 1`, so a rule's
effect on it is just its effect on edges minus its effect on vertices. So instead
of proposing blindly and discarding whatever does not help, the generator favours
rules whose effect points at the target. That improves the *proposals* rather
than the rejections, which is worth far more.

Measured on `lair`, asking for a room count and getting it:

| asked for | got |
|---|---|
| 3 rooms | 5 |
| 6 rooms | 6 |
| 10 rooms | 10 |
| 16 rooms | 15 |

And steering the room graph's shape directly:

```
--loops 0 --connected   →  3 rooms, 2 doorways — a corridor, 0 loops, 2 dead ends
--loops 4 --connected   →  3 rooms, 6 doorways — 4 interlocking loops
```

This is the donut-versus-spaghetti knob, and it needs the *dual*. Cycle rank on
the wall graph (`E − V + 1`) looks like a loopiness measure but equals the
bounded-face count exactly — it is the room count in disguise, and constraining it
just constrains size. The number that matters is the cycle rank of the
room-adjacency graph, which only exists once there are doorways.
`DGGTopology` computes it along with regions, reachability, depth and dead ends.

### Two warnings, both measured

**Hard requirements multiply, and can deadlock.** Each one cuts the acceptance
rate. Worse, if two happen to have disjoint feasible sets the walk churns forever
without ever saying so: `rooms ≤ 12` and `depth ≤ 6` together reached the goal in
0 of 8 seeds, because depth and room count are the same quantity in that family.
The soft version of the same goal reached it in 5 of 8. Use hard requirements for
invariants only.

**A single temperature never settles.** The Metropolis filter keeps accepting
steps away from the target right up to the last iteration, so the result is
wherever the walk happened to stop. Cooling over the run (`cooling`, default 5%
of the starting temperature) lets it roam early and commit late; it is the
difference between `--loops 0` returning three loops and returning zero.

### Some things are impossible, and it is worth knowing which

Most of the obvious knobs are not free variables. In a finished dungeon every
half-edge is glued to its complement, so for each wall label the two sides must
appear equally often. That is a linear system on how many times each primitive is
used, and every quantity a constraint could name is a linear function of that
usage vector. The achievable space is a cone, usually far smaller than the
primitive count suggests, and it can be solved for before generating anything.

`DGGFeasibility` reports it. For `cells`:

```
feasibility: 6 primitives, 5 edge labels, usage cone dimension 2
  3 relation(s) hold in every possible output:
    rock|cell@0° = cell|rock@0°
    cell|cell@90° + rock|cell@90° = cell|rock@0°
    cell|cell@90° + cell|rock@90° = cell|rock@0°
    cell|cell@90°          can be 0.0% – 33.3% of all walls
  limit: no junction in the example has 4 or more walls meeting, so no output
         can contain a crossing — only corners and T-junctions
  limit: cell|cell walls only at 90°
```

So "make half my walls interior partitions" is provably impossible for this
example at any size, seed or iteration count — and the tool says so up front
instead of missing the target quietly for 300 iterations. For `warren` the report
reads *"no chamber|chamber wall exists, so two chamber rooms can never share
one"*, which is a thing an author can act on: draw two adjoining chambers.

It is a necessary condition, not a sufficient one — it ignores planarity and
drawability — so an unreachable request is a definite no and a reachable one is a
maybe.

## What works, and what does not

`cells` generates: two rooms in, ~40 vertices and 19 rooms out, all junctions
drawn from the example, planar, correct angles. `vaults` and `burrow` accept
rewrites but oscillate without growing — their usable moves preserve size.
`warren` still accepts nothing.

The stall was diagnosed by measurement, and it turned out to be three unrelated
things wearing one counter:

1. **The acceptance gate was testing the wrong invariant.** `V − E + F = 2` says
   the rotation system embeds on a sphere. It says nothing about the *angles*,
   which are the entire content of local similarity. Two failures slipped
   through: a face that winds through 720° instead of 360°, and a face whose edge
   directions all lie in one half-plane, so `Σ s·u = 0` has no solution with every
   length positive. `DGGGraph.faces_are_realisable` now checks both. It rejected
   282 of 438 audited candidates with zero false positives, and cut wasted layout
   work sharply (undrawable proposals on `cells`: 2057 → 569, wall-clock 80s →
   29s; on `vaults`: 403 → 0).
2. **`V − E + F = 2` also fails for a graph in two planar pieces**, which scores
   4. Disconnection was being reported as non-planarity, and the two have
   completely different causes. They are counted separately now.
3. **Rule discovery was producing only splitting rules.** At hierarchy depth 3, no
   two graphs share a boundary string on any of the four examples — so a rule
   *cannot* replace one graph with a single other one, and every rule is forced to
   shatter its left side into pieces. Splitting rules are exactly the fragile
   kind: applied one way they disconnect the host, applied the other they need
   the pieces to sit in the arrangement the rule assumed. Matches only start
   appearing at depth 5 (`cells` 9, `vaults` 4, `burrow` 8). The tools were
   overriding `DGGGrammar`'s own default of 5 down to 3, which was the proximate
   cause of the `vaults` stall.

An earlier version of this file blamed unverified piece *arrangement* for all of
it. That was wrong for the single-component case: a match preserves every
vertex's rotation ring exactly, so cutting out one connected piece always leaves
its sockets in boundary-string order. Measured over three examples, the
single-component direction produced **zero** genuinely non-planar results. The
arrangement gap is real, but only where the source side has several components.

Two further changes came out of the same work. Rule selection is now adaptive —
with 632 rules a uniform draw spends nearly every proposal on a rule that matches
nothing, and weighting by recent success took `vaults` from 4 accepted proposals
to 194 and `burrow` from 0 to 144. And `trace_faces` was labelling every face
with the region on the walk's *left* when the walk actually keeps it on the
right, so on `cells` all three faces came back labelled `cell` including the
surrounding rock; a renderer only looked right because every room shared a
colour.

**What is still broken.** `warren` and `burrow` cannot grow. `vaults` oscillates:
at depth 5 its usable moves are size-preserving, so a size target can never be
satisfied. Matching remains the dominant loss — most proposals die because the
rule's left side occurs nowhere in the dungeon — and the remedy is upstream, in
getting rule discovery to produce left sides that actually occur. `max_hierarchy`
is hit at depth 5 on three of the four examples, so every rule set here is
truncated and the measured ceilings are lower bounds. `tools/ceiling.gd`
enumerates every placement of every rule with no sampling, which is the right
harness for judging whether a change helped: if the ceiling is zero, no amount of
cleverness in the placement search will do anything.

Also not implemented: the §7 extension to 3D, and the §5.6 test for graphs with
no complete descendants (the hierarchy is bounded by size instead, which §5.7
allows but which costs the guarantee of reaching *every* locally similar shape).

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
  dgg_feasibility.gd which label ratios the grammar can ever produce
  dgg_topology.gd    rooms, doorways and the room-adjacency graph
  dgg_goals.gd       soft targets, hard requirements, proposal bias
  dgg_layout.gd      angle graph → drawing                            §6.2–§6.3
  dgg_linalg.gd      dense solver with nullspace                      §6.2
  dgg_svg.gd         SVG output
demo/                the interactive front end
tools/               generate, inspect, ceiling, label-conservation
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
