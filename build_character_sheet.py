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
# style helpers
# ---------------------------------------------------------------------------
THIN = Side(border_style="thin", color="888888")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

HEADER_FILL = PatternFill("solid", fgColor="1F2A44")  # dark navy
SUB_FILL = PatternFill("solid", fgColor="3E5377")     # mid navy
HOMEBREW_FILL = PatternFill("solid", fgColor="7A3E5E")  # plum — house rules
LABEL_FILL = PatternFill("solid", fgColor="F2F2F2")
INPUT_FILL = PatternFill("solid", fgColor="FFF6D8")   # cream — user inputs
CALC_FILL = PatternFill("solid", fgColor="E8F0FF")    # pale blue — calculated
WARN_FILL = PatternFill("solid", fgColor="F7C9C9")    # red — over-capacity

H1 = Font(name="Calibri", size=16, bold=True, color="FFFFFF")
H2 = Font(name="Calibri", size=12, bold=True, color="FFFFFF")
H3 = Font(name="Calibri", size=11, bold=True)
BODY = Font(name="Calibri", size=11)
ITAL = Font(name="Calibri", size=11, italic=True, color="555555")

WRAP_TOP = Alignment(wrap_text=True, vertical="top")
CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
LEFT_TOP = Alignment(horizontal="left", vertical="top", wrap_text=True)


def title_row(ws, row, text, span, fill=HEADER_FILL):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=span)
    c = ws.cell(row=row, column=1, value=text)
    c.font = H1
    c.fill = fill
    c.alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[row].height = 24


def section_row(ws, row, text, span, fill=SUB_FILL):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=span)
    c = ws.cell(row=row, column=1, value=text)
    c.font = H2
    c.fill = fill
    c.alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[row].height = 19


def label(ws, row, col, text):
    c = ws.cell(row=row, column=col, value=text)
    c.font = H3
    c.alignment = LEFT_TOP
    c.fill = LABEL_FILL
    c.border = BORDER
    return c


def header_cell(ws, row, col, text, fill=SUB_FILL):
    c = ws.cell(row=row, column=col, value=text)
    c.font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    c.fill = fill
    c.alignment = CENTER
    c.border = BORDER
    return c


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
    ws.sheet_properties.tabColor = "1F2A44"
    title_row(ws, 1, "D&D 5e Character Sheet — Homebrew", 4)

    ws.column_dimensions["A"].width = 26
    ws.column_dimensions["B"].width = 90

    intro = (
        "A printable / fillable D&D 5e character sheet with four house rules baked into the "
        "formulas. Edit the cream cells, read the pale-blue cells (those are calculated).")
    ws.merge_cells("A3:B3")
    c = ws.cell(row=3, column=1, value=intro)
    c.alignment = WRAP_TOP
    c.font = BODY
    ws.row_dimensions[3].height = 36

    section_row(ws, 5, "House rules in this sheet", 4, fill=HOMEBREW_FILL)
    rules = [
        ("Slot-based inventory",
         "Your total carrying slots equal your Strength score. Each inventory entry has a "
         "Slot Cost; the workbook sums them and turns the capacity bar red if you go over."),
        ("Exhaustion (5.5e-style)",
         "Exhaustion runs 0–6. Each level imposes -2 to all d20 tests and reduces speed by "
         "5 ft. At level 6 the character dies. HOMEBREW: each level of exhaustion also "
         "consumes 1 inventory slot, so a heavily-laden character will start to drop "
         "things as they tire."),
        ("Death Tally",
         "At 0 HP the DM secretly rolls 1d4 — that many rounds until the character dies. "
         "This sheet just exposes a counter so the player can track it openly if the table "
         "prefers, or so the DM can mirror it on the screen."),
        ("Static HP",
         "Max HP = (Class HP Base) + (CON modifier), and does not change as you level. "
         "Set Class HP Base to whatever the table agrees on at character creation (e.g. "
         "fighter's d10 max = 10, wizard's d6 max = 6, or a custom value)."),
    ]
    r = 6
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
        ws.row_dimensions[r].height = 48
        r += 1

    section_row(ws, r + 1, "Sheets", 4)
    sheets = [
        ("Character", "Identity, ability scores, combat, homebrew trackers, skills."),
        ("Inventory", "Slot-based inventory grid with capacity bar."),
        ("Combat & Spells",
         "Weapons / attacks block, spell save DC, spell slot tracker, spell list."),
        ("Features & Notes",
         "Class, racial and background features, languages, proficiencies, backstory."),
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
        c.border = BORDER
        ws.row_dimensions[r].height = 22
        r += 1

    section_row(ws, r + 1, "Colour key", 4)
    swatches = [
        (INPUT_FILL, "Cream — user input. Type here."),
        (CALC_FILL,  "Pale blue — calculated. Don't overwrite."),
        (LABEL_FILL, "Grey — field label."),
        (WARN_FILL,  "Red — over-capacity warning."),
    ]
    r += 2
    for fill, desc in swatches:
        c = ws.cell(row=r, column=1, value="")
        c.fill = fill
        c.border = BORDER
        c = ws.cell(row=r, column=2, value=desc)
        c.font = BODY
        c.alignment = LEFT_TOP
        c.border = BORDER
        r += 1


# ---------------------------------------------------------------------------
# Character sheet
# ---------------------------------------------------------------------------
def build_character(wb):
    ws = wb.create_sheet("Character")
    ws.sheet_properties.tabColor = "3E5377"

    # column widths — 10 cols
    widths = [22, 10, 8, 10, 16, 12, 14, 14, 14, 18]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w

    title_row(ws, 1, "Character Sheet", 10)

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
             "All d20 tests (attacks, saves, ability checks, skill checks) take a -2 "
             "penalty per level of exhaustion. The Save Total column already applies this.")

    # ---- combat block, rows 17-19 ----
    section_row(ws, 17, "Combat & Hit Points", 10)
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
             "House rule — HP does NOT scale with level. Max HP = Class HP Base + CON "
             "modifier. Set Class HP Base to your class's HP-die maximum (or whatever the "
             "table agrees on at session zero).")

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
             "Slot Total = STR.  Slots used = items + exhaustion level. If Slots Free goes "
             "negative the capacity bar on the Inventory sheet turns red — drop or stash "
             "until you fit.")

    # over-capacity highlight on this sheet
    ws.conditional_formatting.add(
        "F24",
        FormulaRule(formula=["$F$24<0"], fill=WARN_FILL))

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
    ws.sheet_properties.tabColor = "70AD47"

    widths = [6, 30, 10, 10, 60]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w

    title_row(ws, 1, "Inventory — slot based", 5)

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
        FormulaRule(formula=["$E$4<0"], fill=WARN_FILL))

    note_row(ws, 5, 5,
             "Each level of exhaustion auto-consumes 1 slot. Fill the Slot Cost column for "
             "each item; the capacity bar turns red if you go over.")

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
    ws.sheet_properties.tabColor = "C0504D"

    widths = [22, 14, 16, 18, 14, 14, 14, 14, 50]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w

    title_row(ws, 1, "Combat & Spells", 9)

    # ---- attacks ----
    section_row(ws, 3, "Weapons & Attacks", 9)
    for ci, h in enumerate(["Name", "Ability", "Prof?", "Attack Bonus",
                            "Damage", "Range", "Type", "Ammo / Uses", "Notes"], 1):
        header_cell(ws, 4, ci, h)
    for i in range(10):
        r = 5 + i
        for ci in range(1, 10):
            input_cell(ws, r, ci)

    # ---- spellcasting summary ----
    section_row(ws, 17, "Spellcasting", 9)
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
    section_row(ws, 22, "Spell Slots", 9)
    for ci, h in enumerate(["Level", "1st", "2nd", "3rd", "4th", "5th",
                            "6th", "7th", "8th"], 1):
        header_cell(ws, 23, ci, h)
    header_cell(ws, 23 + 1 - 1, 1, "Level")  # already done; keep loop simple
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
    section_row(ws, 28, "Spell List", 9)
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
    ws.sheet_properties.tabColor = "8064A2"

    widths = [22, 70]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w

    title_row(ws, 1, "Features, Languages & Notes", 2)

    sections = [
        ("Class Features", 8),
        ("Racial Features", 6),
        ("Background Feature", 2),
        ("Feats", 4),
        ("Languages", 3),
        ("Other Proficiencies (tools, instruments, etc.)", 4),
        ("Allies, Organisations & Contacts", 4),
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
