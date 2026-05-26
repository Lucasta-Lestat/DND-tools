"""Generate a D&D 5e character-sheet workbook with four homebrew tweaks:

  1) Slot-based inventory; Slot Total = STR.
  2) Exhaustion counter, 5.5e-style (0–6); each level also occupies 1 slot.
  3) Death Tally counter (rounds-left-alive while at 0 HP).
  4) HP = Class HP Base + CON modifier — does not scale with level.

Run:  python3 build_character_sheet.py
Out:  DnD_Character_Sheet.xlsx
"""

from openpyxl import Workbook
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.table import Table, TableColumn, TableStyleInfo


def add_table_safely(ws, tbl, headers):
    """openpyxl's auto-generated tableColumns use worksheet column indexes as
    IDs, which produces OOXML-invalid tables when the table doesn't start at
    column A. Pre-populate the columns with sequential 1-based IDs to keep
    Excel happy with structured references against the table."""
    if not tbl.tableColumns:
        for i, h in enumerate(headers, 1):
            tbl.tableColumns.append(TableColumn(id=i, name=h))
    ws.add_table(tbl)


# ---------------------------------------------------------------------------
# style helpers — Veins of the Earth aesthetic
#
# Dark stone, bone-parchment lettering, dried-blood section headers, a
# trace of cold lichen-glow on the calculated cells. Serif type throughout.
# ---------------------------------------------------------------------------
THIN = Side(border_style="thin", color="3A3530")  # subtle bone-brown
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

HEADER_FILL = PatternFill("solid", fgColor="0B0B0B")    # the dark of the Veins
SUB_FILL = PatternFill("solid", fgColor="4A1818")       # dried blood
HOMEBREW_FILL = PatternFill("solid", fgColor="5C2A3F")  # bruised plum — house rules
LABEL_FILL = PatternFill("solid", fgColor="1A1817")     # dressed stone
INPUT_FILL = PatternFill("solid", fgColor="2A2520")     # parchment-stained dark
CALC_FILL = PatternFill("solid", fgColor="1F2828")      # lichen-glow stone
WARN_FILL = PatternFill("solid", fgColor="A03333")      # rust — over-capacity / death
# conditional-formatting dxf uses bgColor, not fgColor
WARN_DXF = PatternFill("solid", bgColor="A03333")
ASH_FILL = PatternFill("solid", fgColor="14110F")       # for epigraph rows

TEXT_BONE = "E8DBC4"     # primary on dark — bone / cream
TEXT_ASH = "9C8F7A"      # italics / captions
TEXT_BLOOD = "D67373"    # accent — warnings
TEXT_LICHEN = "8FA876"   # accent — positive/calc emphasis

HEAD_FONT = "Book Antiqua"  # falls back to Cambria/Caladea where unavailable
BODY_FONT = "Cambria"

H1 = Font(name=HEAD_FONT, size=18, bold=True, color=TEXT_BONE)
H2 = Font(name=HEAD_FONT, size=12, bold=True, color=TEXT_BONE)
H3 = Font(name=HEAD_FONT, size=11, bold=True, color=TEXT_BONE)
BODY = Font(name=BODY_FONT, size=11, color=TEXT_BONE)
ITAL = Font(name=BODY_FONT, size=11, italic=True, color=TEXT_ASH)
EPI = Font(name=HEAD_FONT, size=11, italic=True, color=TEXT_ASH)

WRAP_TOP = Alignment(wrap_text=True, vertical="top")
CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
LEFT_TOP = Alignment(horizontal="left", vertical="top", wrap_text=True)


def title_row(ws, row, text, span, fill=HEADER_FILL):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=span)
    c = ws.cell(row=row, column=1, value=text)
    c.font = H1
    c.fill = fill
    c.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[row].height = 32


def section_row(ws, row, text, span, fill=SUB_FILL):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=span)
    c = ws.cell(row=row, column=1, value=text)
    c.font = H2
    c.fill = fill
    c.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    ws.row_dimensions[row].height = 22


def label(ws, row, col, text):
    c = ws.cell(row=row, column=col, value=text)
    c.font = H3
    c.alignment = LEFT_TOP
    c.fill = LABEL_FILL
    c.border = BORDER
    return c


def header_cell(ws, row, col, text, fill=SUB_FILL):
    c = ws.cell(row=row, column=col, value=text)
    c.font = Font(name=HEAD_FONT, size=11, bold=True, color=TEXT_BONE)
    c.fill = fill
    c.alignment = CENTER
    c.border = BORDER
    return c


def epigraph_row(ws, row, span, text, fill=ASH_FILL):
    """A single italic line for atmospheric flavour text under a title."""
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=span)
    c = ws.cell(row=row, column=1, value=text)
    c.font = EPI
    c.fill = fill
    c.alignment = Alignment(horizontal="left", vertical="center")
    c.border = BORDER
    ws.row_dimensions[row].height = 18


def input_cell(ws, row, col, value=None, center=False):
    c = ws.cell(row=row, column=col, value=value)
    c.fill = INPUT_FILL
    c.border = BORDER
    c.font = BODY
    c.alignment = CENTER if center else LEFT_TOP
    return c


def calc_cell(ws, row, col, formula, bold=True):
    c = ws.cell(row=row, column=col, value=formula)
    c.fill = CALC_FILL
    c.border = BORDER
    c.font = H3 if bold else BODY
    c.alignment = CENTER
    return c


def note_row(ws, row, span, text):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=span)
    c = ws.cell(row=row, column=1, value=text)
    c.font = ITAL
    c.alignment = WRAP_TOP
    ws.row_dimensions[row].height = 30
    return c


# ---------------------------------------------------------------------------
# constants
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# 5e class reference (drives auto Max HP and the spell-slot grid)
# ---------------------------------------------------------------------------
# (Class, Hit Die size, CasterType)
CLASSES = [
    ("Artificer", 8, "Half"),
    ("Barbarian", 12, "None"),
    ("Bard", 8, "Full"),
    ("Cleric", 8, "Full"),
    ("Druid", 8, "Full"),
    ("Fighter", 10, "None"),
    ("Monk", 8, "None"),
    ("Paladin", 10, "Half"),
    ("Ranger", 10, "Half"),
    ("Rogue", 8, "None"),
    ("Sorcerer", 6, "Full"),
    ("Warlock", 8, "Pact"),
    ("Wizard", 6, "Full"),
]

# slots[char_lvl] -> [slots1..slots9].  Standard 5e progressions.
FULL_CASTER_SLOTS = {
    1: [2, 0, 0, 0, 0, 0, 0, 0, 0],
    2: [3, 0, 0, 0, 0, 0, 0, 0, 0],
    3: [4, 2, 0, 0, 0, 0, 0, 0, 0],
    4: [4, 3, 0, 0, 0, 0, 0, 0, 0],
    5: [4, 3, 2, 0, 0, 0, 0, 0, 0],
    6: [4, 3, 3, 0, 0, 0, 0, 0, 0],
    7: [4, 3, 3, 1, 0, 0, 0, 0, 0],
    8: [4, 3, 3, 2, 0, 0, 0, 0, 0],
    9: [4, 3, 3, 3, 1, 0, 0, 0, 0],
    10: [4, 3, 3, 3, 2, 0, 0, 0, 0],
    11: [4, 3, 3, 3, 2, 1, 0, 0, 0],
    12: [4, 3, 3, 3, 2, 1, 0, 0, 0],
    13: [4, 3, 3, 3, 2, 1, 1, 0, 0],
    14: [4, 3, 3, 3, 2, 1, 1, 0, 0],
    15: [4, 3, 3, 3, 2, 1, 1, 1, 0],
    16: [4, 3, 3, 3, 2, 1, 1, 1, 0],
    17: [4, 3, 3, 3, 2, 1, 1, 1, 1],
    18: [4, 3, 3, 3, 3, 1, 1, 1, 1],
    19: [4, 3, 3, 3, 3, 2, 1, 1, 1],
    20: [4, 3, 3, 3, 3, 2, 2, 1, 1],
}

HALF_CASTER_SLOTS = {
    1: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    2: [2, 0, 0, 0, 0, 0, 0, 0, 0],
    3: [3, 0, 0, 0, 0, 0, 0, 0, 0],
    4: [3, 0, 0, 0, 0, 0, 0, 0, 0],
    5: [4, 2, 0, 0, 0, 0, 0, 0, 0],
    6: [4, 2, 0, 0, 0, 0, 0, 0, 0],
    7: [4, 3, 0, 0, 0, 0, 0, 0, 0],
    8: [4, 3, 0, 0, 0, 0, 0, 0, 0],
    9: [4, 3, 2, 0, 0, 0, 0, 0, 0],
    10: [4, 3, 2, 0, 0, 0, 0, 0, 0],
    11: [4, 3, 3, 0, 0, 0, 0, 0, 0],
    12: [4, 3, 3, 0, 0, 0, 0, 0, 0],
    13: [4, 3, 3, 1, 0, 0, 0, 0, 0],
    14: [4, 3, 3, 1, 0, 0, 0, 0, 0],
    15: [4, 3, 3, 2, 0, 0, 0, 0, 0],
    16: [4, 3, 3, 2, 0, 0, 0, 0, 0],
    17: [4, 3, 3, 3, 1, 0, 0, 0, 0],
    18: [4, 3, 3, 3, 1, 0, 0, 0, 0],
    19: [4, 3, 3, 3, 2, 0, 0, 0, 0],
    20: [4, 3, 3, 3, 2, 0, 0, 0, 0],
}

# Artificer: like a half caster but starts spell slots at level 1.
ARTIFICER_SLOTS = {
    1: [2, 0, 0, 0, 0, 0, 0, 0, 0],
    2: [2, 0, 0, 0, 0, 0, 0, 0, 0],
    3: [3, 0, 0, 0, 0, 0, 0, 0, 0],
    4: [3, 0, 0, 0, 0, 0, 0, 0, 0],
    5: [4, 2, 0, 0, 0, 0, 0, 0, 0],
    6: [4, 2, 0, 0, 0, 0, 0, 0, 0],
    7: [4, 3, 0, 0, 0, 0, 0, 0, 0],
    8: [4, 3, 0, 0, 0, 0, 0, 0, 0],
    9: [4, 3, 2, 0, 0, 0, 0, 0, 0],
    10: [4, 3, 2, 0, 0, 0, 0, 0, 0],
    11: [4, 3, 3, 0, 0, 0, 0, 0, 0],
    12: [4, 3, 3, 0, 0, 0, 0, 0, 0],
    13: [4, 3, 3, 1, 0, 0, 0, 0, 0],
    14: [4, 3, 3, 1, 0, 0, 0, 0, 0],
    15: [4, 3, 3, 2, 0, 0, 0, 0, 0],
    16: [4, 3, 3, 2, 0, 0, 0, 0, 0],
    17: [4, 3, 3, 3, 1, 0, 0, 0, 0],
    18: [4, 3, 3, 3, 1, 0, 0, 0, 0],
    19: [4, 3, 3, 3, 2, 0, 0, 0, 0],
    20: [4, 3, 3, 3, 2, 0, 0, 0, 0],
}

# Warlock Pact Magic: (slots_count, slot_level)
WARLOCK_SLOTS = {
    1: (1, 1), 2: (2, 1),
    3: (2, 2), 4: (2, 2),
    5: (2, 3), 6: (2, 3),
    7: (2, 4), 8: (2, 4),
    9: (2, 5), 10: (2, 5),
    11: (3, 5), 12: (3, 5), 13: (3, 5), 14: (3, 5), 15: (3, 5), 16: (3, 5),
    17: (4, 5), 18: (4, 5), 19: (4, 5), 20: (4, 5),
}


def slots_for(class_name, char_level):
    """Returns a list of 9 ints — slot count at each spell level for this
    class at this character level."""
    # Class-specific tables first (Artificer differs from the standard
    # Half-caster progression by gaining slots at level 1).
    if class_name == "Artificer":
        return ARTIFICER_SLOTS.get(char_level, [0] * 9)
    if class_name == "Warlock":
        n, lvl = WARLOCK_SLOTS.get(char_level, (0, 0))
        out = [0] * 9
        if 1 <= lvl <= 9:
            out[lvl - 1] = n
        return out
    caster_type = next((c[2] for c in CLASSES if c[0] == class_name), "None")
    if caster_type == "Full":
        return FULL_CASTER_SLOTS.get(char_level, [0] * 9)
    if caster_type == "Half":
        return HALF_CASTER_SLOTS.get(char_level, [0] * 9)
    return [0] * 9


SKILLS = [
    ("Acrobatics", "DEX"),
    ("Animal Handling", "WIS"),
    ("Arcana", "INT"),
    ("Athletics", "STR"),
    ("Deception", "CHA"),
    ("History", "INT"),
    ("Insight", "WIS"),
    ("Intimidation", "CHA"),
    ("Investigation", "INT"),
    ("Medicine", "WIS"),
    ("Nature", "INT"),
    ("Perception", "WIS"),
    ("Performance", "CHA"),
    ("Persuasion", "CHA"),
    ("Religion", "INT"),
    ("Sleight of Hand", "DEX"),
    ("Stealth", "DEX"),
    ("Survival", "WIS"),
]

# CHECK is what a "proficient" tickbox holds.
CHECK = "✓"


# ---------------------------------------------------------------------------
# README sheet
# ---------------------------------------------------------------------------
def build_readme(wb):
    ws = wb.active
    ws.title = "README"
    ws.sheet_properties.tabColor = "0B0B0B"
    title_row(ws, 1, "Character Sheet", 4)

    ws.column_dimensions["A"].width = 26
    ws.column_dimensions["B"].width = 90

    intro = (
        "A 5e character sheet with four house rules baked into the formulas. "
        "Edit the parchment-coloured cells; the lichen-blue cells are calculated and "
        "shouldn't be overwritten.")
    ws.merge_cells("A3:B3")
    c = ws.cell(row=3, column=1, value=intro)
    c.alignment = WRAP_TOP
    c.font = BODY
    c.fill = LABEL_FILL
    c.border = BORDER
    ws.row_dimensions[3].height = 36

    section_row(ws, 5, "House Rules", 4, fill=HOMEBREW_FILL)
    rules = [
        ("Slot-based inventory",
         "Carrying capacity = Strength score, in slots. Each item has a slot cost; the "
         "Inventory sheet's capacity bar turns red if the pack goes over."),
        ("Exhaustion 0-6",
         "Each level applies -2 to all d20 tests and -5 ft to speed; at level 6 the "
         "character dies. Each level of exhaustion also occupies one inventory slot."),
        ("Death Tally",
         "When the character hits 0 HP the GM rolls 1d4 in secret — the number of rounds "
         "before death. The Death Tally cell is for tables that prefer the count visible."),
        ("Static HP from class + CON",
         "Max HP = HP-die maximum (by class) + Constitution modifier. Does not scale with "
         "level. Auto-computed once you select a class."),
        ("DEX score = Initiative",
         "Initiative is the raw Dexterity score, not the modifier. (Not tracked as a "
         "separate field — read it off the DEX row.)"),
        ("Climb speed = half walking speed",
         "Climb Speed is auto-derived from Walking Speed. No separate input needed."),
    ]
    base_row = 6
    r = base_row
    for name, desc in rules:
        c = ws.cell(row=r, column=1, value=name)
        c.font = H3
        c.alignment = LEFT_TOP
        c.fill = LABEL_FILL
        c.border = BORDER
        c = ws.cell(row=r, column=2, value=desc)
        c.alignment = WRAP_TOP
        c.font = BODY
        c.fill = INPUT_FILL
        c.border = BORDER
        ws.row_dimensions[r].height = 60
        r += 1

    section_row(ws, r + 1, "Sheets", 4)
    sheets = [
        ("Character", "Identity, ability scores, combat, homebrew trackers, skills."),
        ("Inventory", "Slot-based pack with auto capacity bar."),
        ("Combat & Spells",
         "Weapons / attacks, spellcasting block, auto-filled spell-slot grid, spells known."),
        ("Features & Notes",
         "Class / racial / background features, languages, proficiencies, backstory."),
        ("_ClassRef",
         "Hidden-friendly helper sheet: ClassDB and SlotTable. Edit only if you're adding "
         "homebrew classes."),
    ]
    r += 2
    for sheet_name, desc in sheets:
        c = ws.cell(row=r, column=1, value=sheet_name)
        c.font = H3
        c.alignment = LEFT_TOP
        c.fill = LABEL_FILL
        c.border = BORDER
        c = ws.cell(row=r, column=2, value=desc)
        c.font = BODY
        c.alignment = WRAP_TOP
        c.fill = LABEL_FILL
        c.border = BORDER
        ws.row_dimensions[r].height = 22
        r += 1

    section_row(ws, r + 1, "Colour Key", 4)
    swatches = [
        (INPUT_FILL, "Input cell — type here."),
        (CALC_FILL,  "Calculated — do not overwrite."),
        (LABEL_FILL, "Field label."),
        (HOMEBREW_FILL, "House-rule field."),
        (WARN_FILL,  "Warning — over capacity / dying."),
    ]
    r += 2
    for fill, desc in swatches:
        c = ws.cell(row=r, column=1, value="")
        c.fill = fill
        c.border = BORDER
        c = ws.cell(row=r, column=2, value=desc)
        c.font = BODY
        c.fill = LABEL_FILL
        c.alignment = LEFT_TOP
        c.border = BORDER
        r += 1


# ---------------------------------------------------------------------------
# Character sheet
# ---------------------------------------------------------------------------
def build_character(wb):
    ws = wb.create_sheet("Character")
    ws.sheet_properties.tabColor = "4A1818"

    # column widths — 10 cols
    widths = [22, 10, 8, 10, 16, 12, 14, 14, 14, 18]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w

    title_row(ws, 1, "Character", 10)

    # ---- identity, rows 3-5 ----
    label(ws, 3, 1, "Character Name")
    ws.merge_cells("B3:D3")
    input_cell(ws, 3, 2)
    label(ws, 3, 5, "Class")
    input_cell(ws, 3, 6)
    label(ws, 3, 7, "Level")
    input_cell(ws, 3, 8, 1, center=True)
    label(ws, 3, 9, "Climb Speed")
    # House rule: climb = floor(walking / 2). Walking is at H5.
    calc_cell(ws, 3, 10, "=FLOOR(H5/2,1)")

    label(ws, 4, 1, "Race / Ancestry")
    ws.merge_cells("B4:D4")
    input_cell(ws, 4, 2)
    label(ws, 4, 5, "Background")
    input_cell(ws, 4, 6)
    label(ws, 4, 7, "Alignment")
    input_cell(ws, 4, 8)
    label(ws, 4, 9, "Player")
    input_cell(ws, 4, 10)

    label(ws, 5, 1, "Proficiency Bonus")
    # 5e default progression: floor((level-1)/4) + 2
    calc_cell(ws, 5, 2, "=IF(ISNUMBER($H$3),INT(($H$3-1)/4)+2,2)")
    label(ws, 5, 3, "Inspiration")
    input_cell(ws, 5, 4, center=True)
    label(ws, 5, 5, "Passive Perception")
    # 10 + WIS mod + (prof × prof bonus on Perception, row 40) – exhaustion penalty
    calc_cell(ws, 5, 6,
              '=10+C13+IF(C40="✓",IF(D40="✓",2,1)*$B$5,0)-2*$A$24')
    label(ws, 5, 7, "Walking Speed")
    input_cell(ws, 5, 8, 30, center=True)
    label(ws, 5, 9, "Effective Walk")
    calc_cell(ws, 5, 10, "=MAX(0,H5-5*$A$24)")  # 5e exhaustion: -5 ft/level

    # Class dropdown — pulled from ClassDB on _ClassRef
    dv_class = DataValidation(
        type="list", formula1="=ClassDB[Class]", allow_blank=True)
    ws.add_data_validation(dv_class)
    dv_class.add(ws.cell(row=3, column=6))

    # ---- ability scores rows 7-14 ----
    section_row(ws, 7, "Ability Scores & Saving Throws", 10)
    for ci, h in enumerate(["Ability", "Score", "Mod", "Save Prof?", "Save Total"], 1):
        header_cell(ws, 8, ci, h)

    abilities = ["STR", "DEX", "CON", "INT", "WIS", "CHA"]
    ability_row = {}
    for i, ab in enumerate(abilities):
        r = 9 + i
        ability_row[ab] = r
        c = ws.cell(row=r, column=1, value=ab)
        c.font = H3
        c.alignment = CENTER
        c.fill = LABEL_FILL
        c.border = BORDER
        input_cell(ws, r, 2, 10, center=True)
        calc_cell(ws, r, 3, f"=INT((B{r}-10)/2)")
        sp = input_cell(ws, r, 4, center=True)
        sp.alignment = CENTER
        # save total = mod + (prof bonus if proficient) – exhaustion penalty
        calc_cell(
            ws, r, 5,
            f'=C{r}+IF(D{r}="{CHECK}",$B$5,0)-2*$A$24')

    note_row(ws, 15, 10,
             "Each level of exhaustion applies -2 to all d20 tests. The Save column "
             "already includes this.")

    # ---- combat block, rows 17-19 ----
    section_row(ws, 17, "Combat & Hit Points", 10)
    combat_headers = ["AC", "Hit Dice (total)", "Max HP",
                      "Current HP", "Temp HP"]
    for ci, h in enumerate(combat_headers, 1):
        header_cell(ws, 18, ci, h)
    # Fill remaining columns of the header row with the SUB_FILL band so there's
    # no visual gap.
    for ci in range(len(combat_headers) + 1, 11):
        c = ws.cell(row=18, column=ci, value="")
        c.fill = SUB_FILL
        c.border = BORDER

    input_cell(ws, 19, 1, 10, center=True)               # AC
    input_cell(ws, 19, 2, "", center=True)               # hit dice
    # Max HP = HitDieMax(class) + CON mod. House rule: does not scale with level.
    calc_cell(ws, 19, 3,
              f'=IFERROR(XLOOKUP($F$3,ClassDB[Class],ClassDB[HitDieMax])+C{ability_row["CON"]},0)',
              bold=True)
    input_cell(ws, 19, 4, "", center=True)               # current HP
    input_cell(ws, 19, 5, 0, center=True)                # temp HP
    # Pad remaining columns of the data row to keep the band continuous.
    for ci in range(len(combat_headers) + 1, 11):
        c = ws.cell(row=19, column=ci, value="")
        c.fill = LABEL_FILL
        c.border = BORDER

    note_row(ws, 20, 10,
             "House rule: Max HP = (Class HP-die maximum) + CON modifier. Auto-computed "
             "from class selection; does not scale with level.")

    # ---- homebrew trackers, rows 22-25 ----
    section_row(ws, 22, "Homebrew Trackers", 10, fill=HOMEBREW_FILL)
    home_headers = ["Exhaustion (0-6)", "Death Tally", "STR Score",
                    "Item Slots Used", "Total Slots Used", "Slots Free",
                    "d20 Penalty", "Speed Penalty"]
    for ci, h in enumerate(home_headers, 1):
        header_cell(ws, 23, ci, h, fill=HOMEBREW_FILL)

    input_cell(ws, 24, 1, 0, center=True)                          # exhaustion
    input_cell(ws, 24, 2, 0, center=True)                          # death tally
    calc_cell(ws, 24, 3, f"=B{ability_row['STR']}")                # STR
    calc_cell(ws, 24, 4, "=Inventory!$C$4")                        # item slots
    calc_cell(ws, 24, 5, "=A24+D24")                               # total used
    calc_cell(ws, 24, 6, "=C24-E24")                               # free
    calc_cell(ws, 24, 7, "=-2*A24")                                # d20 penalty
    calc_cell(ws, 24, 8, "=-5*A24")                                # speed penalty

    note_row(ws, 25, 10,
             "Slot Total = STR. Total Used = items + exhaustion. Slots Free turns red "
             "when it goes negative. Initiative = DEX score (read off the DEX row).")

    # over-capacity highlight on this sheet
    ws.conditional_formatting.add(
        "F24",
        FormulaRule(formula=["$F$24<0"], fill=WARN_DXF))

    # exhaustion 0..6 validation
    dv_ex = DataValidation(
        type="whole", operator="between", formula1=0, formula2=6, allow_blank=False,
        showErrorMessage=True, errorTitle="Out of range",
        error="Exhaustion is tracked 0–6. At 6 the character dies.")
    ws.add_data_validation(dv_ex)
    dv_ex.add(ws.cell(row=24, column=1))

    # death tally 0..4 validation
    dv_dt = DataValidation(
        type="whole", operator="between", formula1=0, formula2=4, allow_blank=True)
    ws.add_data_validation(dv_dt)
    dv_dt.add(ws.cell(row=24, column=2))

    # ---- skills, rows 27+ ----
    section_row(ws, 27, "Skills", 10)
    for ci, h in enumerate(["Skill", "Ability", "Prof?", "Expertise?",
                            "Modifier", "Notes"], 1):
        header_cell(ws, 28, ci, h)

    # merge "Notes" across F..J
    ws.merge_cells("F28:J28")

    for i, (name, ab) in enumerate(SKILLS):
        r = 29 + i
        label(ws, r, 1, name)
        c = ws.cell(row=r, column=2, value=ab)
        c.font = BODY
        c.alignment = CENTER
        c.fill = LABEL_FILL
        c.border = BORDER
        p = input_cell(ws, r, 3, center=True)
        e = input_cell(ws, r, 4, center=True)
        ab_r = ability_row[ab]
        # mod = ability mod + (prof bonus × 1 or 2 if proficient/expertise) – exhaustion
        calc_cell(
            ws, r, 5,
            f'=C{ab_r}+IF(C{r}="{CHECK}",IF(D{r}="{CHECK}",2,1)*$B$5,0)-2*$A$24')
        n = input_cell(ws, r, 6)
        ws.merge_cells(start_row=r, start_column=6, end_row=r, end_column=10)

    # data validations for ✓ checkboxes
    dv = DataValidation(type="list", formula1=f'"{CHECK}"', allow_blank=True)
    ws.add_data_validation(dv)
    # ability save prof
    for r in range(9, 15):
        dv.add(ws.cell(row=r, column=4))
    # skill prof / expertise
    for r in range(29, 29 + len(SKILLS)):
        dv.add(ws.cell(row=r, column=3))
        dv.add(ws.cell(row=r, column=4))


# ---------------------------------------------------------------------------
# Inventory sheet
# ---------------------------------------------------------------------------
def build_inventory(wb):
    ws = wb.create_sheet("Inventory")
    ws.sheet_properties.tabColor = "3A2F2A"

    widths = [6, 30, 10, 10, 60]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w

    title_row(ws, 1, "Inventory", 5)

    # capacity block — row 3 headers, row 4 values
    for ci, h in enumerate(["STR Slots", "Exhaustion Slots", "Item Slots Used",
                            "Total Used", "Free"], 1):
        header_cell(ws, 3, ci, h, fill=HOMEBREW_FILL)

    calc_cell(ws, 4, 1, f"=Character!B{9}")   # STR is at B9 on Character
    calc_cell(ws, 4, 2, "=Character!$A$24")    # exhaustion level
    calc_cell(ws, 4, 3, "=SUM($C$8:$C$57)")    # items
    calc_cell(ws, 4, 4, "=B4+C4")              # total = exhaustion + items
    calc_cell(ws, 4, 5, "=A4-D4")              # free

    # red flag if Free < 0
    ws.conditional_formatting.add(
        "A4:E4",
        FormulaRule(formula=["$E$4<0"], fill=WARN_DXF))

    note_row(ws, 5, 5,
             "Each level of exhaustion auto-occupies one slot. Set the Slot Cost for each "
             "item; the capacity bar reddens when total used exceeds STR.")

    # inventory grid — 50 lines should be plenty
    section_row(ws, 7, "Items", 5)
    for ci, h in enumerate(["#", "Item", "Slot Cost", "Qty", "Notes"], 1):
        header_cell(ws, 8, ci, h)

    for i in range(50):
        r = 9 + i
        c = ws.cell(row=r, column=1, value=i + 1)
        c.alignment = CENTER
        c.fill = LABEL_FILL
        c.font = BODY
        c.border = BORDER
        input_cell(ws, r, 2)
        sc = input_cell(ws, r, 3, center=True)
        # default 0 makes SUM safe
        sc.value = ""
        input_cell(ws, r, 4, center=True)
        input_cell(ws, r, 5)

    # The SUM range above is C8:C57 — but our items start at C9. Fix offset.
    # (header is row 8, items rows 9..58). Adjust formula:
    ws["C4"] = "=SUM($C$9:$C$58)"
    # extend rows to 58 -> we only made 50 items rows 9..58. ✓


# ---------------------------------------------------------------------------
# Combat & Spells sheet
# ---------------------------------------------------------------------------
def build_combat_spells(wb):
    ws = wb.create_sheet("Combat & Spells")
    ws.sheet_properties.tabColor = "6B2E2E"

    widths = [22, 14, 12, 14, 12, 10, 12, 14, 30, 30]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w

    title_row(ws, 1, "Combat & Spells", 10)

    # ---- attacks ----
    section_row(ws, 3, "Weapons & Attacks", 10)
    for ci, h in enumerate(["Name", "Ability", "Prof?", "Attack Bonus",
                            "Damage", "Range", "Type", "Ammo / Uses", "Notes"], 1):
        header_cell(ws, 4, ci, h)
    # Pad column 10 of the header to keep the band continuous
    pad = ws.cell(row=4, column=10, value="")
    pad.fill = SUB_FILL
    pad.border = BORDER
    for i in range(10):
        r = 5 + i
        for ci in range(1, 11):
            input_cell(ws, r, ci)

    # ---- spellcasting summary ----
    section_row(ws, 17, "Spellcasting", 10)
    for ci, h in enumerate(["Spellcasting Class", "Spell Ability",
                            "Spell Save DC", "Spell Attack Bonus",
                            "Ritual?", "Concentration?", "Notes"], 1):
        header_cell(ws, 18, ci, h)
    pad = ws.cell(row=18, column=8, value="")
    pad.fill = SUB_FILL
    pad.border = BORDER
    pad = ws.cell(row=18, column=9, value="")
    pad.fill = SUB_FILL
    pad.border = BORDER
    pad = ws.cell(row=18, column=10, value="")
    pad.fill = SUB_FILL
    pad.border = BORDER

    input_cell(ws, 19, 1)
    input_cell(ws, 19, 2, center=True)
    input_cell(ws, 19, 3, center=True)
    input_cell(ws, 19, 4, center=True)
    input_cell(ws, 19, 5, center=True)
    input_cell(ws, 19, 6, center=True)
    input_cell(ws, 19, 7)
    ws.merge_cells("G19:J19")

    note_row(ws, 20, 10,
             "Spell Save DC = 8 + Proficiency Bonus + Spellcasting Ability modifier. "
             "Spell Attack Bonus = Proficiency Bonus + Spellcasting Ability modifier.")

    # ---- spell slot tracker ----
    section_row(ws, 22, "Spell Slots", 10)
    slot_labels = ["Level", "1st", "2nd", "3rd", "4th", "5th",
                   "6th", "7th", "8th", "9th"]
    for ci, h in enumerate(slot_labels, 1):
        header_cell(ws, 23, ci, h)

    label(ws, 24, 1, "Slots (auto)")
    label(ws, 25, 1, "Used")
    label(ws, 26, 1, "Remaining")
    label(ws, 27, 1, "Display")

    # Per spell-level cols 2-10 = slot levels 1-9
    for slot_lvl in range(1, 10):
        col = 1 + slot_lvl  # 2..10
        # Auto total: filter SlotTable for matching Class + char Lvl, take SlotsN
        slot_total_formula = (
            f'=IFERROR(INDEX(FILTER(SlotTable[Slots{slot_lvl}],'
            f'(SlotTable[Class]=Character!$F$3)*(SlotTable[Lvl]=Character!$H$3)),1),0)')
        calc_cell(ws, 24, col, slot_total_formula)
        # Used = manual input (default 0)
        input_cell(ws, 25, col, 0, center=True)
        # Remaining = total - used
        col_l = get_column_letter(col)
        calc_cell(ws, 26, col, f"=MAX(0,{col_l}24-{col_l}25)")
        # Display = ○ for remaining, ● for used; — if no slots
        calc_cell(ws, 27, col,
                  f'=IF({col_l}24=0,"—",'
                  f'TRIM(REPT("○ ",{col_l}26)&REPT("● ",MIN({col_l}25,{col_l}24))))')

    # ---- spell list ----
    section_row(ws, 29, "Spells Known & Prepared", 10)
    for ci, h in enumerate(["Spell", "Level", "School", "Cast Time", "Range",
                            "Components", "Duration", "Prepared?", "Notes"], 1):
        header_cell(ws, 30, ci, h)
    pad = ws.cell(row=30, column=10, value="")
    pad.fill = SUB_FILL
    pad.border = BORDER
    for i in range(40):
        r = 31 + i
        for ci in range(1, 11):
            input_cell(ws, r, ci)

    # validation for Prepared? column → ✓ (now starts row 31)
    dv = DataValidation(type="list", formula1=f'"{CHECK}"', allow_blank=True)
    ws.add_data_validation(dv)
    for r in range(31, 31 + 40):
        dv.add(ws.cell(row=r, column=8))
    # validation for ritual / concentration too
    for r in (19,):
        dv.add(ws.cell(row=r, column=5))
        dv.add(ws.cell(row=r, column=6))
    # validation for Prof? on attacks
    for r in range(5, 5 + 10):
        dv.add(ws.cell(row=r, column=3))


# ---------------------------------------------------------------------------
# Features & Notes
# ---------------------------------------------------------------------------
def build_features(wb):
    ws = wb.create_sheet("Features & Notes")
    ws.sheet_properties.tabColor = "5C2A3F"

    widths = [22, 70]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w

    title_row(ws, 1, "Features & Notes", 2)

    sections = [
        ("Class Features", 8),
        ("Racial / Ancestry Features", 6),
        ("Background Feature", 2),
        ("Feats", 4),
        ("Languages", 3),
        ("Other Proficiencies (tools, instruments, etc.)", 4),
        ("Allies & Contacts", 4),
        ("Backstory", 6),
        ("Session Notes", 8),
    ]
    r = 3
    for title, rows in sections:
        section_row(ws, r, title, 2)
        r += 1
        for _ in range(rows):
            label(ws, r, 1, "")
            ws.cell(row=r, column=1).fill = LABEL_FILL
            input_cell(ws, r, 2)
            ws.row_dimensions[r].height = 22
            r += 1


# ---------------------------------------------------------------------------
# _ClassRef helper sheet — drives Max HP and the spell-slot grid
# ---------------------------------------------------------------------------
def build_classref(wb):
    ws = wb.create_sheet("_ClassRef")
    ws.sheet_properties.tabColor = "808080"

    # ---- ClassDB at A1 (Class, HitDie, HitDieMax, CasterType) ----
    cdb_headers = ["Class", "HitDie", "HitDieMax", "CasterType"]
    for ci, h in enumerate(cdb_headers, 1):
        c = ws.cell(row=1, column=ci, value=h)
        c.font = Font(name=HEAD_FONT, size=11, bold=True, color=TEXT_BONE)
        c.fill = SUB_FILL
        c.alignment = CENTER
    for ri, (cls, die, ctype) in enumerate(CLASSES, 2):
        ws.cell(row=ri, column=1, value=cls)
        ws.cell(row=ri, column=2, value=f"d{die}")
        ws.cell(row=ri, column=3, value=die)
        ws.cell(row=ri, column=4, value=ctype)
    cdb_last = 1 + len(CLASSES)
    cdb_ref = f"A1:D{cdb_last}"
    cdb_table = Table(displayName="ClassDB", ref=cdb_ref)
    cdb_table.tableStyleInfo = TableStyleInfo(
        name="TableStyleLight15", showRowStripes=True)
    add_table_safely(ws, cdb_table, cdb_headers)

    # ---- SlotTable at F1 (Class, Lvl, Slots1..Slots9) ----
    st_start = 6  # F
    st_headers = (["Class", "Lvl"] +
                  [f"Slots{i}" for i in range(1, 10)])
    for ci, h in enumerate(st_headers, st_start):
        c = ws.cell(row=1, column=ci, value=h)
        c.font = Font(name=HEAD_FONT, size=11, bold=True, color=TEXT_BONE)
        c.fill = SUB_FILL
        c.alignment = CENTER

    ri = 2
    for cls, _die, _ctype in CLASSES:
        for lvl in range(1, 21):
            slots = slots_for(cls, lvl)
            ws.cell(row=ri, column=st_start + 0, value=cls)
            ws.cell(row=ri, column=st_start + 1, value=lvl)
            for k, s in enumerate(slots):
                ws.cell(row=ri, column=st_start + 2 + k, value=s)
            ri += 1
    st_last = ri - 1
    st_first_col = get_column_letter(st_start)
    st_last_col = get_column_letter(st_start + len(st_headers) - 1)
    st_ref = f"{st_first_col}1:{st_last_col}{st_last}"
    st_table = Table(displayName="SlotTable", ref=st_ref)
    st_table.tableStyleInfo = TableStyleInfo(
        name="TableStyleLight10", showRowStripes=True)
    add_table_safely(ws, st_table, st_headers)

    for col in range(1, st_start + len(st_headers)):
        ws.column_dimensions[get_column_letter(col)].width = 11
    ws.column_dimensions["A"].width = 14
    ws.column_dimensions[st_first_col].width = 14


def main():
    wb = Workbook()
    build_readme(wb)
    build_character(wb)
    build_inventory(wb)
    build_combat_spells(wb)
    build_features(wb)
    build_classref(wb)
    out = "DnD_Character_Sheet.xlsx"
    wb.save(out)
    print("wrote", out)


if __name__ == "__main__":
    main()
