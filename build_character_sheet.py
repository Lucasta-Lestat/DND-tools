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
    title_row(ws, 1, "A Sheet for Delvers of the Veins", 4)
    epigraph_row(ws, 2, 4,
                 "  You go down because there is something down there. "
                 "You take with you what your back can carry. Past that, you leave it behind.")

    ws.column_dimensions["A"].width = 26
    ws.column_dimensions["B"].width = 90

    intro = (
        "A 5e character sheet rebuilt for play in the Veins of the Earth. The vanilla bones "
        "of a character sheet, but reworked for the dark: your pack is what your back can "
        "carry, tiredness fills it, and your hit points are what they are — level grants "
        "skill, not flesh. Edit the parchment-dark cells. Read the lichen-glow cells; those "
        "are calculated.")
    ws.merge_cells("A4:B4")
    c = ws.cell(row=4, column=1, value=intro)
    c.alignment = WRAP_TOP
    c.font = BODY
    c.fill = LABEL_FILL
    c.border = BORDER
    ws.row_dimensions[4].height = 64

    section_row(ws, 6, "House Rules", 4, fill=HOMEBREW_FILL)
    rules = [
        ("The Pack",
         "Your carrying capacity is your Strength score, in slots. Heavy things take more. "
         "The dark always offers more to carry than you can — the capacity bar reddens the "
         "moment you've said yes to too much."),
        ("Tiredness (Exhaustion 0–6)",
         "Each level applies -2 to all d20 tests and -5 ft to your speed; at level 6 the "
         "dark wins. The Veins charge an extra fee: each level of exhaustion also fills a "
         "slot in your pack, since a tired delver fumbles, drops, leaves things behind."),
        ("The Death Tally",
         "When you hit 0 HP the GM rolls 1d4 in secret. That is the number of rounds before "
         "the dark takes you. The Death Tally cell is for the GM to mirror, or for the "
         "table that prefers their dying open."),
        ("Static HP",
         "You do not grow harder to kill the deeper you go. Max HP = (Class HP Base) + "
         "(CON modifier). Set Class HP Base once at session zero — a fighter's d10 maxes at "
         "10, a wizard's d6 at 6, or pick your own number — and it stays there. Level "
         "grants skill, not flesh."),
    ]
    base_row = 7
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
        ("Character", "Names, faculties, combat, the burdens, practiced crafts."),
        ("Inventory", "Pack & pockets — what your back chose to carry."),
        ("Combat & Spells",
         "Steel & sorcery — weapons, the spellcasting block, slots, spells known."),
        ("Features & Notes",
         "Lineage, tongue, the things that made you — and notes from the dark."),
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
        (INPUT_FILL, "Parchment-dark — write here."),
        (CALC_FILL,  "Lichen-glow — calculated. Do not overwrite."),
        (LABEL_FILL, "Dressed stone — field label."),
        (HOMEBREW_FILL, "Bruised plum — house-rule fields."),
        (WARN_FILL,  "Rust — the dark is winning (over capacity, dying)."),
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

    title_row(ws, 1, "A Delver — Names & Numbers", 10)
    epigraph_row(ws, 2, 10,
                 "  Lit lantern. Finite name. The dark is patient.")

    # ---- identity, rows 3-5 ----
    label(ws, 3, 1, "Character Name")
    ws.merge_cells("B3:D3")
    input_cell(ws, 3, 2)
    label(ws, 3, 5, "Class")
    input_cell(ws, 3, 6)
    label(ws, 3, 7, "Level")
    input_cell(ws, 3, 8, 1, center=True)
    label(ws, 3, 9, "XP")
    input_cell(ws, 3, 10, 0, center=True)

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
    label(ws, 5, 7, "Speed (base)")
    input_cell(ws, 5, 8, 30, center=True)
    label(ws, 5, 9, "Speed (effective)")
    calc_cell(ws, 5, 10, "=MAX(0,H5-5*$A$24)")  # 5e exhaustion: -5 ft/level

    # ---- ability scores rows 7-14 ----
    section_row(ws, 7, "Faculties & Saving Throws", 10)
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
             "Tiredness has weight. Every d20 test — attack, save, check — loses 2 per "
             "level of exhaustion; the Save column already does this for you.")

    # ---- combat block, rows 17-19 ----
    section_row(ws, 17, "Combat & the Dying Hours", 10)
    combat_headers = ["AC", "Initiative", "Hit Dice (total)", "Class HP Base",
                      "CON mod", "Max HP", "Current HP", "Temp HP", "Death Saves S/F"]
    for ci, h in enumerate(combat_headers, 1):
        header_cell(ws, 18, ci, h)
    input_cell(ws, 19, 1, 10, center=True)               # AC
    calc_cell(ws, 19, 2, f"=C{ability_row['DEX']}-2*$A$24")  # initiative w/ exhaustion
    input_cell(ws, 19, 3, "", center=True)               # hit dice
    input_cell(ws, 19, 4, 8, center=True)                # class HP base
    calc_cell(ws, 19, 5, f"=C{ability_row['CON']}")      # CON mod
    calc_cell(ws, 19, 6, "=D19+E19", bold=True)          # Max HP — HOMEBREW
    input_cell(ws, 19, 7, "", center=True)               # current HP
    input_cell(ws, 19, 8, 0, center=True)                # temp HP
    input_cell(ws, 19, 9, "", center=True)               # death save successes/failures

    note_row(ws, 20, 10,
             "You do not grow harder to kill the deeper you go. Max HP = Class HP Base + "
             "CON modifier; set the base once and leave it. Level grants skill, not flesh.")

    # ---- homebrew trackers, rows 22-25 ----
    section_row(ws, 22, "Burdens — Exhaustion, Death, the Pack", 10,
                fill=HOMEBREW_FILL)
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
             "Your back's worth: Slot Total = STR.  Slots used = items + exhaustion. If "
             "Slots Free turns negative the Inventory capacity bar reddens — drop, cache, "
             "or leave behind until you fit again.")

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
    section_row(ws, 27, "Skills & Practiced Crafts", 10)
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

    title_row(ws, 1, "What You Carry — Slot by Slot", 5)
    epigraph_row(ws, 2, 5,
                 "  Heavy things take more. The dark always offers more to carry than you can.")

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
             "Tiredness fills slots before items do — each level of exhaustion takes one. "
             "Set the Slot Cost for each thing in your pack; the capacity bar runs rust the "
             "moment you've taken on more than your back will keep.")

    # inventory grid — 50 lines should be plenty
    section_row(ws, 7, "Pack & Pockets", 5)
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

    widths = [22, 14, 16, 18, 14, 14, 14, 14, 50]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w

    title_row(ws, 1, "Steel & Sorcery", 9)
    epigraph_row(ws, 2, 9,
                 "  Steel is honest. Magic is rented. Both run out.")

    # ---- attacks ----
    section_row(ws, 3, "Weapons & What They Cut", 9)
    for ci, h in enumerate(["Name", "Ability", "Prof?", "Attack Bonus",
                            "Damage", "Range", "Type", "Ammo / Uses", "Notes"], 1):
        header_cell(ws, 4, ci, h)
    for i in range(10):
        r = 5 + i
        for ci in range(1, 10):
            input_cell(ws, r, ci)

    # ---- spellcasting summary ----
    section_row(ws, 17, "Spellcraft — The Rented Power", 9)
    for ci, h in enumerate(["Spellcasting Class", "Spell Ability",
                            "Spell Save DC", "Spell Attack Bonus",
                            "Ritual?", "Concentration?", "Notes"], 1):
        header_cell(ws, 18, ci, h)
    input_cell(ws, 19, 1)
    input_cell(ws, 19, 2, center=True)
    # spell save DC = 8 + prof + ability mod (manual until they pick ability)
    input_cell(ws, 19, 3, center=True)
    input_cell(ws, 19, 4, center=True)
    input_cell(ws, 19, 5, center=True)
    input_cell(ws, 19, 6, center=True)
    input_cell(ws, 19, 7)
    ws.merge_cells("G19:I19")

    note_row(ws, 20, 9,
             "Spell Save DC = 8 + Proficiency Bonus + Spellcasting Ability modifier.  "
             "Spell Attack Bonus = Proficiency Bonus + Spellcasting Ability modifier.")

    # ---- spell slot tracker ----
    section_row(ws, 22, "Spell Slots — How Much Magic Is Left in You", 9)
    for ci, h in enumerate(["Level", "1st", "2nd", "3rd", "4th", "5th",
                            "6th", "7th", "8th"], 1):
        header_cell(ws, 23, ci, h)
    label(ws, 24, 1, "Total")
    label(ws, 25, 1, "Used")
    label(ws, 26, 1, "Remaining")
    for col in range(2, 10):
        input_cell(ws, 24, col, 0, center=True)
        input_cell(ws, 25, col, 0, center=True)
        calc_cell(ws, 26, col, f"={get_column_letter(col)}24-{get_column_letter(col)}25")

    # 9th slot column (one only)
    ws.column_dimensions["J"].width = 8
    header_cell(ws, 23, 10, "9th")
    input_cell(ws, 24, 10, 0, center=True)
    input_cell(ws, 25, 10, 0, center=True)
    calc_cell(ws, 26, 10, "=J24-J25")

    # ---- spell list ----
    section_row(ws, 28, "Spells Known & Prepared", 9)
    for ci, h in enumerate(["Spell", "Level", "School", "Cast Time", "Range",
                            "Components", "Duration", "Prepared?", "Notes"], 1):
        header_cell(ws, 29, ci, h)
    for i in range(40):
        r = 30 + i
        for ci in range(1, 10):
            input_cell(ws, r, ci)

    # validation for Prepared? column → ✓
    dv = DataValidation(type="list", formula1=f'"{CHECK}"', allow_blank=True)
    ws.add_data_validation(dv)
    for r in range(30, 30 + 40):
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

    title_row(ws, 1, "Lineage, Tongue & Tale", 2)
    epigraph_row(ws, 2, 2,
                 "  Where you came from is a place no one down here asks about.")

    sections = [
        ("Class Features", 8),
        ("Racial / Ancestry Features", 6),
        ("Background Feature", 2),
        ("Feats & Earned Tricks", 4),
        ("Tongues You Speak", 3),
        ("Other Proficiencies (tools, instruments, the disassembling of things)", 4),
        ("Allies, Pacts & Contacts", 4),
        ("Where You Came From — Backstory", 6),
        ("Notes From the Dark — Session Log", 8),
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
def main():
    wb = Workbook()
    build_readme(wb)
    build_character(wb)
    build_inventory(wb)
    build_combat_spells(wb)
    build_features(wb)
    out = "DnD_Character_Sheet.xlsx"
    wb.save(out)
    print("wrote", out)


if __name__ == "__main__":
    main()
