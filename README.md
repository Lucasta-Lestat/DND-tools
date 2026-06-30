# DND-tools

A small collection of spreadsheet-based tools for tabletop play.

## Workbooks

### 1. WWN Faction System — Veins of the Earth

A spreadsheet implementation of the [Worlds Without Number](https://www.drivethrurpg.com/en/product/348791/worlds-without-number)
faction subsystem (Kevin Crawford, Sine Nomine Publishing), prefilled with the
principal cultures of Patrick Stuart and Scrap Princess's *Veins of the Earth*
(Lamentations of the Flame Princess).

| File | What it is |
| --- | --- |
| `WWN_Veins_of_the_Earth_Factions.xlsx` | The workbook you use at the table. |
| `build_workbook.py` | Generator script. Edit and re-run to tweak. |

Sheets: README, Rules, Actions, Assets (core + Veins setting assets), Tags,
Goals, Combat Tracker, Roster, one per faction (Knotsmen, Aelf-Adal, Funginids,
dErO, Dvargir, Gnonmen, Substratals, Deep Janeen, Olm), and a Blank Faction
template.

### 2. D&D 5e Character Sheet (Homebrew)

A fillable character sheet with four house rules baked into the formulas.

| File | What it is |
| --- | --- |
| `DnD_Character_Sheet.xlsx` | The workbook. |
| `build_character_sheet.py` | Generator. |

**House rules:**

- **Slot-based inventory.** Total slots = Strength score. Each inventory entry
  has a Slot Cost and the capacity bar turns red when you go over.
- **Exhaustion (5.5e-style, 0–6).** Each level imposes -2 to all d20 tests and
  -5 ft of speed. At level 6 the character dies. **Homebrew:** each level of
  exhaustion also consumes 1 inventory slot.
- **Death Tally.** A counter you can use openly to mirror the DM's secret 1d4
  on a downed character.
- **Static HP.** Max HP = (Class HP Base) + (CON modifier). Does **not**
  increase as you level.

Sheets: README, Character, Inventory, Combat & Spells, Features & Notes.

### 3. Aperture Publisher (desktop publishing app)

A standalone, browser-based desktop-publishing app that replicates the core of
Affinity Publisher — including **StudioLink** persona switching, master pages,
paragraph styles, and linked text flow — intended for laying out a homebrew RPG
rulebook. It does not depend on the spreadsheets above.

| Path | What it is |
| --- | --- |
| `publisher/` | The app (open `publisher/index.html` via a static server). |

See [`publisher/README.md`](publisher/README.md) for features and how to run it.

## Regenerating

```sh
pip install openpyxl
python3 build_workbook.py            # faction workbook
python3 build_character_sheet.py     # character sheet
```
