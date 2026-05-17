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

### 3. Elf Maids and Octopi — d100 Tables Scraper

Pulls every post tagged `d100` from
[Elf Maids and Octopi](https://elfmaidsandoctopi.blogspot.com) via the Blogger
JSON feed and writes them into a single workbook, one sheet per table.

| File | What it is |
| --- | --- |
| `scrape_d100_tables.py` | Scraper + Excel writer. |
| `EMO_d100_tables.xlsx` | Output (generated; not checked in). |

Each sheet has a `#` / `Entry` table parsed from the post's `<ol>` lists, with
a regex fallback for posts that use plain numbered lines. Posts that can't be
parsed are still included with their raw text so nothing is lost. An `Index`
sheet links back to every post URL.

### 4. Coins and Scrolls — Tables Scraper

Pulls posts from [Coins and Scrolls](https://coinsandscrolls.blogspot.com)
via the Blogger JSON feed and writes one sheet per `<table>` found, with the
section subheaders Skerples interleaves between batches preserved as bold
rows merged across the table width. Both d100-style and 2-column lookup
tables (e.g. saint-name → domain) are supported. Falls back to numbered-line
regex parsing for posts that don't use `<table>` markup.

| File | What it is |
| --- | --- |
| `scrape_coinsandscrolls_tables.py` | Scraper + Excel writer. |
| `CoinsAndScrolls_tables.xlsx` | Output (generated; not checked in). |

Useful flags: `--label <tag>` to filter (default: all posts), `--d100-only`
to skip lookup tables, `--min-rows N` to drop layout tables, `--limit N` for
a quick smoke test.

## Regenerating

```sh
pip install openpyxl requests beautifulsoup4
python3 build_workbook.py                       # faction workbook
python3 build_character_sheet.py                # character sheet
python3 scrape_d100_tables.py                   # EMO d100 tables
python3 scrape_coinsandscrolls_tables.py        # Skerples tables
```
