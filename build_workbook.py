"""Generate the WWN-faction-system workbook prefilled with Veins of the Earth factions.

Run:   python3 build_workbook.py
Out:   WWN_Veins_of_the_Earth_Factions.xlsx
"""

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo


# ---------------------------------------------------------------------------
# styling helpers
# ---------------------------------------------------------------------------
THIN = Side(border_style="thin", color="888888")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

HEADER_FILL = PatternFill("solid", fgColor="1F2A44")
SUB_FILL = PatternFill("solid", fgColor="3E5377")
ROW_FILL_A = PatternFill("solid", fgColor="F2F2F2")
ROW_FILL_B = PatternFill("solid", fgColor="FFFFFF")
ACCENT_FILL = PatternFill("solid", fgColor="FFE6A0")
NOTE_FILL = PatternFill("solid", fgColor="EAF3FF")

H1 = Font(name="Calibri", size=16, bold=True, color="FFFFFF")
H2 = Font(name="Calibri", size=12, bold=True, color="FFFFFF")
H3 = Font(name="Calibri", size=11, bold=True)
BODY = Font(name="Calibri", size=11)
ITAL = Font(name="Calibri", size=11, italic=True, color="555555")

WRAP_TOP = Alignment(wrap_text=True, vertical="top")
CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
LEFT_TOP = Alignment(horizontal="left", vertical="top", wrap_text=True)


def title_row(ws, row, text, span):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=span)
    c = ws.cell(row=row, column=1, value=text)
    c.font = H1
    c.fill = HEADER_FILL
    c.alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[row].height = 24


def section_row(ws, row, text, span):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=span)
    c = ws.cell(row=row, column=1, value=text)
    c.font = H2
    c.fill = SUB_FILL
    c.alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[row].height = 19


def write_table(ws, start_row, headers, rows, widths=None, name=None):
    """Write a banded table starting at start_row, return last row used."""
    for ci, h in enumerate(headers, 1):
        c = ws.cell(row=start_row, column=ci, value=h)
        c.font = H2
        c.fill = SUB_FILL
        c.alignment = CENTER
        c.border = BORDER
    ws.row_dimensions[start_row].height = 28

    for ri, row in enumerate(rows):
        fill = ROW_FILL_A if ri % 2 == 0 else ROW_FILL_B
        for ci, val in enumerate(row, 1):
            c = ws.cell(row=start_row + 1 + ri, column=ci, value=val)
            c.font = BODY
            c.fill = fill
            c.alignment = LEFT_TOP
            c.border = BORDER

    if widths:
        for ci, w in enumerate(widths, 1):
            ws.column_dimensions[get_column_letter(ci)].width = w

    return start_row + len(rows)


# ---------------------------------------------------------------------------
# data: rules, actions, assets, tags, goals
# ---------------------------------------------------------------------------

# rules summary — paraphrased reference rules so the sheet stands on its own
RULES = [
    ("Faction Attributes",
     "Every faction has four attributes: FORCE (military and brute power), CUNNING (subtlety, "
     "espionage, intrigue), WEALTH (economic and material strength), and MAGIC (arcane power; 0 "
     "for ordinary factions). Each attribute is rated 1–8. Starting NPC factions are usually "
     "rated 1–3 in each. A faction may freely own as many assets of a given type as its rating "
     "in that attribute; assets beyond that limit cost 1 Treasure each per turn in upkeep."),
    ("Hit Points",
     "Faction HP = 4 + Force + Cunning + Wealth + Magic. A faction at 0 HP is broken/destroyed. "
     "HP is healed by the Heal Damage action (1 Treasure per 1 HP, max equal to faction's "
     "max HP per turn)."),
    ("Treasure Income",
     "At the start of each turn: gain Treasure = (Wealth / 2) + (Force / 4) + (Cunning / 4), "
     "rounded up. Add income from special assets (Farmers, Markets, Tax Collectors, etc.)."),
    ("Faction Experience",
     "Factions earn XP by completing Goals. Each completed goal grants 1 FacXP (or more for "
     "Major Goals). At 8 FacXP the faction levels (Tier increases) and may raise one attribute "
     "by 1 (max 8). The GM may award bonus XP for narratively significant achievements."),
    ("Locations",
     "Assets exist in a specific Location (region, city, hex, etc.). Asset-vs-asset attacks "
     "must be in the same location. The Move Asset action relocates an asset (costs 1 Treasure "
     "per location crossed, or per the asset's listed move cost)."),
    ("Turn Order (each Faction Turn)",
     "1) Collect Treasure income.  2) Pay upkeep for excess assets (1 Treasure each); unpaid "
     "assets are destroyed.  3) Trigger any free-action / Special assets.  4) Take ONE Action "
     "(see Actions sheet).  5) Check Goal completion and gain FacXP.  6) Roll for any "
     "narrative events the GM has prepared."),
    ("Combat Resolution",
     "When asset A attacks asset B: each side rolls 1d10 + the attribute listed in the "
     "attacker's stat line (e.g. F vs F means attacker rolls 1d10 + Force, defender rolls "
     "1d10 + Force). Highest total wins ties go to the defender. On attacker win, attacker "
     "deals listed damage. On defender win, if defender has a Counter value, the defender "
     "deals that damage to the attacker. Reduced to 0 HP = destroyed."),
    ("Stealth & Subtlety",
     "Stealthed assets are unknown to rivals until they reveal themselves (by attacking, "
     "being detected, or being placed openly). Subtle assets perform their action without "
     "revealing the owning faction. Detecting hidden assets is a Cunning vs Cunning check."),
    ("Magic Threshold",
     "A faction must have Magic 1+ to own Magic assets. A faction at Magic 0 cannot purchase "
     "or use magical assets, and Magic-using attacks default against its lowest score."),
    ("Faction Tags",
     "Each faction has one or more Tags (see Tags sheet). Tags grant special abilities, "
     "discounts, or restrictions and characterise the faction's flavour."),
]

# ----- actions -----
ACTIONS_HEADERS = ["Action", "Cost", "Effect", "Notes"]
ACTIONS = [
    ("Attack",
     "Free (uses turn)",
     "Direct one of your assets to attack a rival asset in the same location. Resolve combat "
     "(see Rules).",
     "Both sides may sustain damage. The defender's counter (if any) hits the attacker."),
    ("Move Asset",
     "1 Treasure per location crossed (or asset's listed move cost)",
     "Relocate one asset from its current location to an adjacent or further location.",
     "Mobile assets ignore movement cost. Stealthed assets stay hidden if a Cunning check "
     "succeeds vs the rival's Cunning."),
    ("Heal Damage / Repair Asset",
     "1 Treasure per HP restored",
     "Restore HP either to the faction itself or to a single damaged asset. Maximum healed "
     "per turn equals the faction's max HP.",
     "Cannot exceed the asset's maximum HP."),
    ("Expand Influence",
     "Wealth check vs DC set by location; 1 Treasure",
     "Project influence into a new location, allowing assets to be placed there next turn.",
     "Contested by any faction with assets already in that location."),
    ("Refit Asset",
     "Difference in cost between old and new asset",
     "Replace one of your existing assets with another asset that shares its base type "
     "(Force, Cunning, Wealth or Magic).",
     "Useful for upgrading without burning a build turn."),
    ("Create / Buy Asset",
     "Asset's Cost in Treasure; requires minimum attribute rating",
     "Build a new asset in a location your faction influences. Cost may be reduced by "
     "supporting assets such as Workshops, Armories, or Magic Workshops.",
     "Assets cannot be built where your faction has no presence."),
    ("Hide Asset",
     "Free (uses turn)",
     "Make a non-Stealthed asset Stealthed via a Cunning vs Cunning check against any rival "
     "watching the location.",
     "Subtle assets are inherently hidden; this is for normal ones."),
    ("Sell Asset",
     "—",
     "Permanently disband an asset and recover half its purchase cost (round down) as "
     "Treasure.",
     "Cannot be done while the asset is engaged in combat."),
    ("Use Asset Ability",
     "Per ability description",
     "Trigger a special ability listed in an asset's stat block (e.g. Spies' Special, "
     "Cult Network's conversion).",
     "Counts as your faction Action for the turn unless the ability says Free Action."),
    ("Seize Planet / Region",
     "Major undertaking — usually multiple turns",
     "Attempt to take political control of a region by reducing the rival's assets there "
     "to zero and winning a final Force or Cunning check.",
     "Listed as a goal target rather than a normal action."),
    ("Diplomatic Exchange",
     "Variable — by agreement",
     "Trade Treasure, intelligence, locations or assets with another faction.",
     "Cannot transfer assets that require unmet attribute prerequisites."),
]

# ----- assets -----
# (Name, Type, Cost, HP, AttackStats, Damage, Counter, MinAttr, Traits, Notes)
ASSETS_HEADERS = ["Asset", "Type", "Cost", "HP", "Attack (Atk vs Def)", "Damage",
                  "Counter", "Min Attr", "Traits", "Notes / Special"]

FORCE_ASSETS = [
    ("Militia", "Force", 1, 4, "F vs F", "1d4", "1d4", "Force 1", "—",
     "Cheap, locally-raised levies. Easy to recruit, easy to break."),
    ("Brigands", "Force", 2, 6, "F vs F", "1d6", "1d4", "Force 1", "Mobile",
     "Bandit-style irregulars; lives off the land."),
    ("Mercenaries", "Force", 4, 6, "F vs F", "1d8", "1d6", "Force 2", "—",
     "Paid blades. Reliable until the gold runs out."),
    ("Infantry", "Force", 4, 8, "F vs F", "1d8", "1d6", "Force 2", "—",
     "Disciplined foot soldiers; the workhorse of any faction."),
    ("Light Cavalry", "Force", 5, 8, "F vs F", "1d8", "1d6", "Force 3", "Mobile",
     "Scouts, raiders and skirmishers."),
    ("Heavy Infantry", "Force", 6, 10, "F vs F", "1d10", "1d8", "Force 3", "—",
     "Armoured close-order troops."),
    ("Border Fort", "Force", 6, 20, "—", "—", "1d6", "Force 3", "Action",
     "Defensive bulwark. Lets a single asset there ignore the first 1d4 damage per attack."),
    ("Cavalry", "Force", 8, 12, "F vs F", "1d10", "1d8", "Force 4", "Mobile",
     "Heavy horse; expensive, frightening."),
    ("War Wagons", "Force", 10, 14, "F vs F", "2d6", "1d8", "Force 4", "Mobile",
     "Armoured rolling platforms; murderous on open ground."),
    ("Battle Mages", "Force", 10, 8, "F vs F", "1d10", "1d6", "Force 3, Magic 1", "Special",
     "Wizards trained for war. Once per turn ignore the defender's Counter."),
    ("Knights / Champions", "Force", 12, 14, "F vs F", "2d6", "1d10", "Force 5", "—",
     "Heroes and household warriors."),
    ("Citadel", "Force", 12, 30, "—", "—", "1d10", "Force 4", "Action",
     "Fortified stronghold. Reduces damage to any one asset sharing its location by 1d4."),
    ("Pretorian Guard", "Force", 16, 18, "F vs F", "2d8", "2d6", "Force 6", "—",
     "Elite lifeguards and shock troops."),
    ("Armoury", "Force", 4, 6, "—", "—", "—", "Force 2", "Special",
     "Reduces cost of new Force assets created at this location by 1 (min 1)."),
    ("Conscription Office", "Force", 4, 6, "—", "—", "—", "Force 2", "Special",
     "Once per turn produce a free Militia asset in this location."),
]

CUNNING_ASSETS = [
    ("Informers", "Cunning", 1, 3, "C vs C", "1d4", "—", "Cunning 1", "Stealthed, Special",
     "Provide warning of incoming attacks; on a Cunning check, attacker reveals itself."),
    ("Smugglers", "Cunning", 2, 4, "C vs W", "1d6", "—", "Cunning 1", "Stealthed, Mobile",
     "Move goods or assets across borders cheaply; halves Move costs."),
    ("Brigand Cell", "Cunning", 2, 6, "C vs F", "1d6", "1d4", "Cunning 1", "Mobile",
     "Highwaymen and racketeers."),
    ("Spies", "Cunning", 4, 4, "C vs C", "1d6", "—", "Cunning 2", "Stealthed, Subtle",
     "Once per turn learn one fact about a rival's hidden assets or income."),
    ("Saboteurs", "Cunning", 4, 6, "C vs W", "2d4", "—", "Cunning 2", "Subtle",
     "Hit infrastructure rather than soldiers."),
    ("Whisper Network", "Cunning", 4, 6, "C vs C", "1d6", "1d4", "Cunning 2", "Subtle",
     "Coordinates rumours; increases the DC of rival Expand Influence rolls by 1 in shared "
     "locations."),
    ("Thieves' Guild", "Cunning", 4, 8, "C vs W", "1d8", "1d6", "Cunning 3", "—",
     "Organised crime. Generates 1 Treasure every other turn (5+ on 1d6)."),
    ("Bribed Officials", "Cunning", 6, 8, "C vs C", "1d6", "—", "Cunning 3", "Subtle, Special",
     "Allow one extra Move action per turn at no Treasure cost."),
    ("Assassins", "Cunning", 6, 6, "C vs F", "1d10", "—", "Cunning 3", "Stealthed, Action",
     "Strike vulnerable leaders. Double damage vs HP-4-or-less assets."),
    ("Cult Network", "Cunning", 8, 10, "C vs C", "1d10", "—", "Cunning 4", "Subtle, Special",
     "Once per turn, attempt to convert a 1-cost rival asset to your side (Cunning check)."),
    ("Eyes Everywhere", "Cunning", 8, 10, "C vs C", "1d8", "1d4", "Cunning 4", "Stealthed",
     "Reveal any one Stealthed rival asset in the same location once per turn."),
    ("Seductive Cabal", "Cunning", 10, 10, "C vs C", "1d10", "—", "Cunning 5", "Subtle",
     "Charm and blackmail. Reduces a rival faction's Cunning by 1 while present."),
    ("Plain-Clothes Enforcers", "Cunning", 6, 8, "C vs F", "1d8", "1d6", "Cunning 3", "—",
     "Secret police. Strong against Stealthed assets."),
]

WEALTH_ASSETS = [
    ("Farmers", "Wealth", 1, 4, "W vs W", "1d4", "1d4", "Wealth 1", "Special",
     "On 5+ on 1d6 at start of turn, gain 1 Treasure."),
    ("Pedlars", "Wealth", 1, 4, "W vs W", "1d4", "—", "Wealth 1", "Mobile",
     "Travelling traders; can move freely each turn."),
    ("Smiths", "Wealth", 2, 6, "W vs F", "1d6", "1d4", "Wealth 2", "—",
     "Provide arms and tools. Discount Force assets here by 1 cost."),
    ("Workshops", "Wealth", 4, 6, "—", "—", "—", "Wealth 2", "Special",
     "Reduce cost of new Wealth and Force assets here by 1 (min 1)."),
    ("Storehouses", "Wealth", 4, 8, "—", "—", "—", "Wealth 2", "Special",
     "Stockpile up to 4 Treasure that can be spent later or moved."),
    ("Bonded Service", "Wealth", 6, 8, "W vs F", "1d8", "1d4", "Wealth 3", "—",
     "Indentured labour. Provides 1 Treasure every other turn."),
    ("Markets", "Wealth", 6, 8, "W vs W", "1d6", "—", "Wealth 3", "Special",
     "Gain +1 Treasure each turn this asset is unharmed."),
    ("Slavers", "Wealth", 6, 8, "W vs F", "1d8", "1d4", "Wealth 3", "—",
     "Captures sentient assets; can convert a defeated 1-cost enemy into 1 Treasure."),
    ("Usurers", "Wealth", 4, 8, "W vs W", "1d10", "—", "Wealth 3", "Special",
     "Take 1d4 damage when used to reduce cost of building or repairing an asset by 2."),
    ("Tax Collectors", "Wealth", 8, 10, "W vs W", "1d8", "1d4", "Wealth 4", "Special",
     "Generate +1 Treasure each turn; +2 if no rival Wealth asset shares the location."),
    ("Trade Treaty", "Wealth", 8, 10, "W vs W", "1d6", "—", "Wealth 4", "Subtle",
     "Each turn, gain +1 Treasure for every faction you have a treaty with."),
    ("Counting House", "Wealth", 12, 12, "W vs W", "1d10", "1d6", "Wealth 5", "—",
     "Banker-financier. Holds Treasure between turns and lets you lend to other factions."),
    ("Merchant Princes", "Wealth", 16, 14, "W vs W", "2d6", "1d8", "Wealth 6", "—",
     "Family dynasties that dominate trade. +2 Treasure per turn."),
    ("Insurance Compact", "Wealth", 8, 10, "W vs W", "1d6", "1d4", "Wealth 4", "Special",
     "Pay 1 Treasure to negate the loss of a destroyed Wealth asset (once per turn)."),
]

MAGIC_ASSETS = [
    ("Hedge Mages", "Magic", 4, 6, "M vs M", "1d6", "1d4", "Magic 1", "—",
     "Folk witches and cunning-folk; cheap arcane help."),
    ("Spirit Walkers", "Magic", 6, 6, "M vs C", "1d6", "—", "Magic 2", "Stealthed, Subtle",
     "Scout the spirit world; reveal one rival Stealthed asset per turn."),
    ("Ritual Casters", "Magic", 6, 6, "M vs M", "1d8", "1d4", "Magic 2", "Subtle",
     "Strike at consecrated targets; double damage vs Cult Networks."),
    ("Witch Coven", "Magic", 8, 8, "M vs M", "1d8", "1d6", "Magic 2", "—",
     "Cabal of practitioners; reduces enemy Magic by 1 while present."),
    ("Magic Workshop", "Magic", 8, 10, "—", "—", "—", "Magic 2", "Special",
     "Reduces cost of Magic assets here by 1 (min 1) and stores 2 Treasure."),
    ("Bound Spirit", "Magic", 8, 12, "M vs F", "1d8", "1d6", "Magic 3", "—",
     "Servitor entity; resilient and obedient."),
    ("Demonologists", "Magic", 10, 8, "M vs M", "1d10", "1d4", "Magic 3", "Subtle",
     "Pact-bound summoners. Once per turn deal 1d6 damage at distance."),
    ("Adept Order", "Magic", 12, 12, "M vs M", "1d10", "1d6", "Magic 4", "—",
     "Formal magical school; tutors next generations of casters."),
    ("Wonderworker", "Magic", 16, 14, "M vs M", "2d6", "1d8", "Magic 5", "Special",
     "Singular master-mage. Once per turn cast a Heal Damage (4 HP) for free."),
    ("Death Cult", "Magic", 6, 8, "M vs C", "1d6", "1d4", "Magic 2", "Subtle",
     "Death-magic cell; gains 1 Treasure each time an asset is destroyed in the location."),
    ("Living Idol", "Magic", 10, 14, "M vs M", "1d8", "1d6", "Magic 3", "Special",
     "Animated cult-focus. Heals 1 HP per turn while in a location with a Cult Network."),
]

ALL_ASSETS = FORCE_ASSETS + CUNNING_ASSETS + WEALTH_ASSETS + MAGIC_ASSETS

# ----- Veins-of-the-Earth setting-specific assets -----
# Designed to flavour faction rosters with the textures of Patrick Stuart's
# Veins: bioluminescence, hunger, dream, contract, fungal infection, geomancy,
# drowned tunnels, and the dignity (or rage) of small light.

VEINS_FORCE_ASSETS = [
    ("Tunnel Crawlers", "Force", 3, 6, "F vs F", "1d6", "1d4", "Force 2", "Mobile",
     "Light infantry trained for narrow ways; Move cost ignored within the Veins."),
    ("Lantern Wardens", "Force", 5, 8, "F vs M", "1d8", "1d4", "Force 3", "Special",
     "Gnonmen heavy-light bearers. While present, rival Magic and Stealthed attacks in this "
     "location are at -1 to the roll."),
    ("Stone-Eaters", "Force", 8, 14, "F vs F", "1d10", "1d8", "Force 4, Magic 2", "Special",
     "Substratal close-order elementals. Halve all damage from non-Magic attacks."),
    ("Crystal Lancers", "Force", 8, 8, "F vs M", "1d10", "1d6", "Force 3, Magic 1", "Special",
     "dErO troops with crackling polearms. Double damage vs Magic assets."),
    ("Spore-Maddened Slaves", "Force", 3, 8, "F vs F", "1d6", "—", "Force 2", "Fanatic",
     "Funginid spore-controlled bodies. Cannot retreat and cannot be Healed."),
    ("Dream-Knights of the Black Glass Court", "Force", 14, 16, "F vs C", "2d6", "1d10",
     "Force 5, Magic 2", "—",
     "Aelf-Adal household champions. +1 to attack rolls vs locations under any Cult Network."),
]

VEINS_CUNNING_ASSETS = [
    ("Spore-Wreaths", "Cunning", 4, 6, "C vs C", "1d6", "—", "Cunning 2", "Stealthed, Subtle",
     "Funginid spy-mats. If destroyed in a location with another Funginid asset, re-roots at "
     "1 HP next turn at no cost."),
    ("Lightless Cartographers", "Cunning", 3, 4, "C vs C", "1d4", "—", "Cunning 1",
     "Stealthed, Mobile",
     "Veins mapmakers. Once per turn, reveal one unexplored adjacent location to the owning "
     "faction."),
    ("Debt-Collectors", "Cunning", 5, 6, "C vs W", "1d8", "—", "Cunning 2, Magic 1", "Subtle",
     "Knotsmen with infernally binding scrolls. On a successful attack, owner gains 1 Treasure "
     "instead of (or in addition to) inflicting the last 2 damage."),
    ("Dream-Walkers", "Cunning", 6, 6, "C vs M", "1d8", "—", "Cunning 3, Magic 2",
     "Stealthed, Subtle",
     "Aelf-Adal subconscious infiltrators. May attack any asset in a location that contains a "
     "Cult Network, regardless of distance."),
    ("Olm Listeners", "Cunning", 2, 4, "C vs C", "1d6", "—", "Cunning 1", "Stealthed",
     "Silent amphibians pressed to wet stone. Free action: on 4+ on 1d6, learn one rival "
     "action declared this turn."),
    ("Janeen Aesthete-Spies", "Cunning", 8, 8, "C vs C", "1d10", "—", "Cunning 4, Magic 2",
     "Subtle",
     "Deep Janeen connoisseur-intelligencers. Each turn, reveal one tag of a rival faction "
     "(may also be used as polite blackmail)."),
]

VEINS_WEALTH_ASSETS = [
    ("Mushroom Fields", "Wealth", 2, 6, "W vs W", "1d4", "1d4", "Wealth 2", "Special",
     "Gnonmen subsistence cultivation. On 4+ on 1d6 at turn start, gain 1 Treasure. Any fire "
     "or scour attack deals +3 damage to this asset."),
    ("Pact-Vaults", "Wealth", 10, 10, "W vs W", "1d8", "1d4", "Wealth 4, Magic 1", "Special",
     "Knotsmen infernal banking. Stockpiles up to 6 Treasure. If destroyed, the stored "
     "Treasure is lost AND the attacker's nearest Wealth asset takes 2d6 damage from "
     "vengeful contract-fiends."),
    ("Crystal Mines", "Wealth", 6, 10, "W vs F", "1d6", "1d6", "Wealth 3, Magic 1", "Special",
     "dErO industrial workings. +1 Treasure per turn; reduces the Cost of Magic assets built "
     "at this location by 1 (min 1)."),
    ("Maze-Toll", "Wealth", 8, 10, "W vs M", "1d6", "—", "Wealth 4, Magic 3", "Special",
     "Deep Janeen labyrinth-entry. +2 Treasure per turn while undisturbed; collapses (asset "
     "destroyed) if any rival Magic asset enters the location."),
    ("Hidden Larder", "Wealth", 2, 4, "—", "—", "—", "Wealth 1", "Stealthed, Special",
     "Olm food caches squirreled into wet stone. Spend 1 Treasure as a free action to bring "
     "one of your destroyed non-Magic 1-cost assets back at 1 HP in this location."),
    ("Substratal Tribute Stones", "Wealth", 6, 10, "—", "—", "—", "Wealth 3, Magic 2",
     "Special",
     "Geomantic tax-pillars. Generates +1 Treasure per turn for every Magic asset that "
     "shares this location, including rivals'."),
]

VEINS_MAGIC_ASSETS = [
    ("Spore-Cathedral Choir", "Magic", 8, 10, "M vs M", "1d8", "1d6", "Magic 3", "Special",
     "Funginid ritualists. At start of each turn, heal 1 HP to every Funginid Cunning asset "
     "in this location."),
    ("Dream Anchor", "Magic", 10, 14, "M vs M", "1d6", "1d8", "Magic 4", "Special",
     "Aelf-Adal sleeping-relic. Rival Magic actions in this location cost +1 Treasure."),
    ("Demonic Notary", "Magic", 12, 10, "M vs M", "1d10", "1d6", "Magic 3", "Subtle, Special",
     "Knotsmen pact-fiend. Once per turn, force any rival to pay 1 Treasure or cancel an "
     "action declared against your faction."),
    ("Hearth-Lantern Shrine", "Magic", 5, 8, "M vs M", "1d6", "1d4", "Magic 2", "Special",
     "Gnonmen warding-light. Stealthed assets in this location are revealed automatically; "
     "the light does not permit hiding."),
    ("Stone-Voice Oracle", "Magic", 10, 14, "M vs M", "1d8", "1d8", "Magic 4", "Special",
     "Substratal seer-elemental. At start of each turn, the owner may force one rival to "
     "declare their action before declaring their own."),
    ("Olm Anatomist", "Magic", 8, 8, "M vs F", "2d4", "—", "Magic 3", "Stealthed, Special",
     "Knower of unmaking-shapes. Deals double damage to any asset with HP 6 or less."),
]

VEINS_ASSETS = (VEINS_FORCE_ASSETS + VEINS_CUNNING_ASSETS +
                VEINS_WEALTH_ASSETS + VEINS_MAGIC_ASSETS)

ALL_ASSETS = ALL_ASSETS + VEINS_ASSETS

# ----- faction tags -----
TAGS_HEADERS = ["Tag", "Effect"]
TAGS = [
    ("Antimagical",
     "Magic attacks against this faction's assets are made at –2 to the roll. May not own "
     "Magic assets."),
    ("Concordat",
     "Faction has long-standing treaties; gains +1 Treasure for every other faction it has "
     "not attacked in the last 4 turns."),
    ("Cult of Personality",
     "Faction's leader counts as a free Cunning 8 asset for purposes of resisting Cunning "
     "attacks while alive."),
    ("Eugenic Cult",
     "Once per turn, may sacrifice one 1-cost asset to add +1 to a different asset's HP "
     "permanently."),
    ("Fanatic",
     "All assets gain +1 damage on attacks but cannot retreat or be Healed mid-combat."),
    ("Imperialist",
     "Pays half cost (round up) for Expand Influence rolls."),
    ("Industrious",
     "Workshops, Smiths and Magic Workshops generate +1 additional Treasure per turn."),
    ("Innovative",
     "May create one asset with a special, GM-approved homebrew rule each Tier."),
    ("Mage-Killers",
     "All assets gain +2 damage vs Magic assets. May not own Magic assets."),
    ("Mercantile",
     "Gains +1 Treasure per turn for every Wealth asset above 3."),
    ("Pillagers",
     "Successful Attack actions also generate 1 Treasure (raid loot)."),
    ("Plundering Horde",
     "All Force assets gain Mobile. Cannot own Wealth assets except Storehouses."),
    ("Preceptors",
     "Magic Workshops and Adept Orders cost 2 less to build."),
    ("Savage",
     "Force assets cost 1 less to create but cannot occupy locations with Markets, Banks, "
     "or Counting Houses."),
    ("Scavengers",
     "Once per turn may rebuild a destroyed asset of cost 4 or less for half its Cost."),
    ("Secretive",
     "Cunning assets start Stealthed automatically; rivals roll at –2 to detect them."),
    ("Skinwearers",
     "Once per turn the faction may have one defeated rival asset come back as one of its "
     "own assets of equal or lesser Cost (GM approval)."),
    ("Theocracy",
     "Cult Networks and Magic assets cost 2 less. Magic assets gain +1 to defence rolls."),
    ("Tyrannical",
     "Force assets cost 1 less to upkeep, but assets generate –1 Treasure per turn from "
     "unrest."),
    ("Warlike",
     "Gains 1 free Faction XP each turn the faction performs an Attack action."),
    ("Xenophiles",
     "Diplomatic Exchange actions never cost Treasure and the faction gains +1 FacXP on "
     "completing trade goals."),
    ("Subterranean (homebrew, Veins-of-the-Earth)",
     "All assets ignore the first point of movement cost while inside the Veins / Underdark. "
     "Surface operations cost +1 Treasure."),
    ("Demon-Pacted (homebrew)",
     "Gain +1 Treasure per turn from infernal patronage. Lose 1 HP from a destroyed asset "
     "every time a contract is broken."),
    ("Dream-Born (homebrew)",
     "All assets are Stealthed by default while in the same location as a Cult Network. "
     "May not act on surface locations exposed to bright sunlight."),
    ("Hive-Mind (homebrew)",
     "Faction may transfer HP freely between its assets at the start of each turn."),
]

# ----- goals -----
GOALS_HEADERS = ["Goal", "Difficulty", "Description / Trigger", "XP Reward"]
GOALS = [
    ("Military Conquest", "Major",
     "Destroy or seize at least 4 enemy assets in a single Tier.", "2 FacXP"),
    ("Commercial Expansion", "Minor",
     "Earn at least 8 Treasure income above your turn baseline over the Tier.", "1 FacXP"),
    ("Inciting Incident", "Minor",
     "Successfully cause two factions you do not control to attack each other.", "1 FacXP"),
    ("Internal Subversion", "Major",
     "Reduce a rival's Cunning or Wealth by 2 through Subtle actions.", "2 FacXP"),
    ("Intrigue", "Minor",
     "Place at least one hidden asset inside every rival faction's home location.", "1 FacXP"),
    ("Expand Influence", "Minor",
     "Gain 4 new locations within a Tier.", "1 FacXP"),
    ("Invincible Valor", "Major",
     "Win an Attack against an asset whose Cost is at least twice your attacker's.", "2 FacXP"),
    ("Destroy the Foe", "Major",
     "Reduce a rival faction's HP to 0 or to no assets.", "3 FacXP"),
    ("Wealth of Worlds", "Major",
     "Reach a Wealth rating of 8 or hold 30+ banked Treasure.", "2 FacXP"),
    ("Inside the Enemy", "Minor",
     "Maintain a hidden asset inside a rival faction's home location for 3 turns.", "1 FacXP"),
    ("Peaceable Kingdom", "Minor",
     "End 3 consecutive turns without losing any assets or HP.", "1 FacXP"),
    ("Religious Conversion", "Major",
     "Use Cult Network or Theocracy abilities to convert 3 rival assets.", "2 FacXP"),
    ("Tech / Magic Expansion", "Major",
     "Reach Magic 4+ or own 6+ Magic assets.", "2 FacXP"),
    ("Veins-Walker", "Minor (setting)",
     "Establish a permanent caravan path between two distant Veins regions.", "1 FacXP"),
    ("Surface Strike", "Major (setting)",
     "Successfully launch and complete an operation against a surface faction.", "3 FacXP"),
    ("Dream Disruption", "Major (setting)",
     "Prevent the Aelf-Adal from completing their own goal twice in a row.", "2 FacXP"),
]

# ----- combat tracker labels -----
COMBAT_FIELDS = [
    ("Attacker faction", ""),
    ("Attacker asset", ""),
    ("Attacker attribute used", ""),
    ("Attacker attribute rating", ""),
    ("Attacker d10 roll", ""),
    ("Attacker total", ""),
    ("Defender faction", ""),
    ("Defender asset", ""),
    ("Defender attribute used", ""),
    ("Defender attribute rating", ""),
    ("Defender d10 roll", ""),
    ("Defender total", ""),
    ("Winner (highest; ties to defender)", ""),
    ("Damage dealt (winner deals listed)", ""),
    ("Counter-attack damage (defender wins)", ""),
    ("Notes", ""),
]


# ---------------------------------------------------------------------------
# Veins-of-the-Earth factions (prefilled)
# ---------------------------------------------------------------------------
# Each entry is a dict describing a faction. Stats are interpretive
# starting values appropriate for a sandbox campaign — adjust as needed.

VEINS_FACTIONS = [
    {
        "name": "The Knotsmen",
        "tagline": "Bureaucrats of debt, torturers of the ledger.",
        "description": (
            "Stunted underground humans warped by life beneath the Earth and by ancient pacts "
            "with demons of contract and account. Their entire civilisation is a vast filing "
            "system: every action incurs interest, every breath is owed. Trade with them at "
            "your peril — they will never give you anything for free and they always collect."
        ),
        "force": 2, "cunning": 4, "wealth": 4, "magic": 2,
        "treasure": 8,
        "tags": ["Demon-Pacted (homebrew)", "Tyrannical", "Subterranean (homebrew, Veins-of-the-Earth)"],
        "hq": "The Compounding Vaults",
        "goal": "Wealth of Worlds — accumulate 30+ banked Treasure through usury and pacts.",
        "assets": [
            ("Bonded Service", "Wealth", "Mid-Veins markets"),
            ("Usurers",        "Wealth", "Compounding Vaults"),
            ("Pact-Vaults",    "Wealth", "Compounding Vaults"),
            ("Debt-Collectors","Cunning","Surface debtor towns"),
            ("Demonic Notary", "Magic",  "Hall of Contracts"),
            ("Mercenaries",    "Force",  "Compounding Vaults"),
            ("Saboteurs",      "Cunning","Rival faction debt-houses"),
        ],
    },
    {
        "name": "The Aelf-Adal",
        "tagline": "Refugees of nightmare, plotting the unmaking of the day.",
        "description": (
            "Beautiful, cruel, dream-born exiles. Their kingdom was beaten back into the dark "
            "long ago and they have spent centuries plotting the reversal of the waking world. "
            "They hate all life that is not them, but cannot risk pure genocide — they fear "
            "their own existence depends on someone, somewhere, still dreaming of them."
        ),
        "force": 3, "cunning": 5, "wealth": 2, "magic": 4,
        "treasure": 6,
        "tags": ["Dream-Born (homebrew)", "Secretive", "Cult of Personality"],
        "hq": "The Hall of Mirroring Dreams",
        "goal": "Internal Subversion — reduce a surface faction's Cunning by 2 via Subtle play.",
        "assets": [
            ("Dream-Walkers",  "Cunning","Multiple surface courts"),
            ("Assassins",      "Cunning","Mirror Halls"),
            ("Cult Network",   "Cunning","Veins waystations"),
            ("Witch Coven",    "Magic",  "Mirror Halls"),
            ("Adept Order",    "Magic",  "Mirror Halls"),
            ("Dream-Knights of the Black Glass Court", "Force", "Black Glass Court"),
            ("Dream Anchor",   "Magic",  "Sleeping Sanctum"),
        ],
    },
    {
        "name": "The Funginids",
        "tagline": "Slave-mushrooms scheming a second extinction.",
        "description": (
            "Sentient walking fungi met chiefly as the slaves of animal races. Beneath that "
            "passivity their colonial mind is engineering catastrophe — an event of mass death "
            "to recreate the carrion-rich substrate their ancestors once thrived in."
        ),
        "force": 2, "cunning": 4, "wealth": 1, "magic": 3,
        "treasure": 3,
        "tags": ["Hive-Mind (homebrew)", "Secretive", "Subterranean (homebrew, Veins-of-the-Earth)"],
        "hq": "The Spore-Cathedral",
        "goal": "Religious Conversion — convert 3 rival assets via spore-cult infiltration.",
        "assets": [
            ("Cult Network",        "Cunning","Slave-pens across the Veins"),
            ("Spore-Wreaths",       "Cunning","Every slave market"),
            ("Spore-Maddened Slaves","Force", "Cattle-races' larders"),
            ("Spore-Cathedral Choir","Magic", "Spore-Cathedral"),
            ("Death Cult",          "Magic",  "Carrion grounds"),
            ("Hedge Mages",         "Magic",  "Spore-Cathedral"),
        ],
    },
    {
        "name": "The dErO",
        "tagline": "Crystal-paranoiacs with rays for every paranoia.",
        "description": (
            "Chaotic gnome-things with bulbous heads, fevered conspiracies, and a half-mad "
            "techno-arcane proficiency built from crystals, brass, and stolen lightning. They "
            "are watching you. They are listening. They are also wrong about most of it."
        ),
        "force": 3, "cunning": 4, "wealth": 2, "magic": 3,
        "treasure": 4,
        "tags": ["Innovative", "Mage-Killers", "Secretive"],
        "hq": "The Buzzing Halls",
        "goal": "Tech / Magic Expansion — reach Magic 4 by stealing crystal lore.",
        "assets": [
            ("Eyes Everywhere","Cunning","Buzzing Halls"),
            ("Crystal Mines",  "Wealth", "Crystal Pylons"),
            ("Crystal Lancers","Force",  "Crystal Pylons"),
            ("Bribed Officials","Cunning","Surface intelligence services"),
            ("Demonologists",  "Magic",  "Lower Buzzing Halls"),
            ("Magic Workshop", "Magic",  "Buzzing Halls"),
            ("Whisper Network","Cunning","Across the Veins"),
        ],
    },
    {
        "name": "The Dvargir",
        "tagline": "Eugenic engine-dwarves, distilled into work.",
        "description": (
            "Distilled deep-dwarves whose society is one enormous, generations-long work "
            "programme — refining themselves toward perfect, automaton-like efficiency. They "
            "view all of reality as a substrate on which work is to be performed."
        ),
        "force": 5, "cunning": 2, "wealth": 4, "magic": 1,
        "treasure": 7,
        "tags": ["Industrious", "Eugenic Cult", "Tyrannical"],
        "hq": "Forgeholds of Anvil-Below",
        "goal": "Commercial Expansion — 8 Treasure of surplus income via forgework.",
        "assets": [
            ("Heavy Infantry", "Force",  "Forgeholds"),
            ("Workshops",      "Wealth", "Forgeholds"),
            ("Smiths",         "Wealth", "Forgeholds"),
            ("Slavers",        "Wealth", "Caravan routes"),
            ("Armoury",        "Force",  "Forgeholds"),
            ("Citadel",        "Force",  "Anvil-Below"),
            ("Tax Collectors", "Wealth", "Vassal warrens"),
        ],
    },
    {
        "name": "The Gnonmen",
        "tagline": "Quiet, brave, light-bearing — the only good thing in the dark.",
        "description": (
            "Deep gnomes who refuse the Veins' default: despair. They revere small light, "
            "the protection of life, and decisive action in the present. Where they pass, "
            "for a moment, the dark gets a little less."
        ),
        "force": 3, "cunning": 3, "wealth": 2, "magic": 2,
        "treasure": 4,
        "tags": ["Concordat", "Xenophiles", "Subterranean (homebrew, Veins-of-the-Earth)"],
        "hq": "The Lantern Holds",
        "goal": "Peaceable Kingdom — survive 3 turns without losing an asset.",
        "assets": [
            ("Lantern Wardens",     "Force",  "Lantern Holds"),
            ("Tunnel Crawlers",     "Force",  "Veins patrol routes"),
            ("Spirit Walkers",      "Magic",  "Lantern Holds"),
            ("Mushroom Fields",     "Wealth", "Surface of the Lantern Holds"),
            ("Hearth-Lantern Shrine","Magic", "Lantern Holds"),
            ("Lightless Cartographers","Cunning","Across Gnonmen friend-networks"),
            ("Border Fort",         "Force",  "Upper passes"),
        ],
    },
    {
        "name": "The Substratals",
        "tagline": "Earth-elementals more conscious than your summoning intended.",
        "description": (
            "Things you accidentally call up when you cast Earth Elemental too close to the "
            "actual source. They have politics. They have grudges. They are very, very old "
            "and they do not see human-scale conflict so much as remember it later, slowly."
        ),
        "force": 6, "cunning": 1, "wealth": 1, "magic": 5,
        "treasure": 3,
        "tags": ["Antimagical", "Subterranean (homebrew, Veins-of-the-Earth)", "Fanatic"],
        "hq": "The Sunken Heart",
        "goal": "Invincible Valor — defeat an asset of twice the attacker's Cost.",
        "assets": [
            ("Stone-Voice Oracle",      "Magic",  "Sunken Heart"),
            ("Stone-Eaters",            "Force",  "Sunken Heart"),
            ("Substratal Tribute Stones","Wealth","Veins frontier"),
            ("Citadel",                 "Force",  "Stone-fields"),
            ("Ritual Casters",          "Magic",  "Sunken Heart"),
            ("Bound Spirit",            "Magic",  "Substratal frontier"),
        ],
    },
    {
        "name": "The Deep Janeen",
        "tagline": "Solitary genies of stone, building mazes for the soul.",
        "description": (
            "Elemental aristocrats of the deep earth: flighty, artistic, fabulously dangerous "
            "to speak to. They build labyrinths as status symbols and will sometimes politely "
            "ask the survivor of one to write them a review."
        ),
        "force": 4, "cunning": 4, "wealth": 5, "magic": 6,
        "treasure": 10,
        "tags": ["Cult of Personality", "Innovative", "Mercantile"],
        "hq": "Each in their own maze",
        "goal": "Wealth of Worlds — Wealth 8 or 30+ Treasure stockpiled.",
        "assets": [
            ("Wonderworker",         "Magic",  "Their personal maze"),
            ("Adept Order",          "Magic",  "Janeen courts"),
            ("Maze-Toll",            "Wealth", "Each maze entrance"),
            ("Counting House",       "Wealth", "Janeen courts"),
            ("Janeen Aesthete-Spies","Cunning","Surface and underdark salons"),
            ("Bound Spirit",         "Magic",  "Janeen frontier"),
        ],
    },
    {
        "name": "The Olm",
        "tagline": "Rubbery, eel-pale, always hungry, never quite a cannibal.",
        "description": (
            "Pale, blind, amphibious humanoids who know the unmaking-shapes of every thing "
            "they meet. They are constantly hungry and deeply insulted by anyone who suggests "
            "they would eat a person."
        ),
        "force": 3, "cunning": 3, "wealth": 1, "magic": 2,
        "treasure": 3,
        "tags": ["Savage", "Subterranean (homebrew, Veins-of-the-Earth)", "Scavengers"],
        "hq": "The Drowned Galleries",
        "goal": "Veins-Walker — establish permanent caravan path between two distant Veins.",
        "assets": [
            ("Brigands",        "Force",  "Drowned Galleries"),
            ("Smugglers",       "Cunning","Underwater Vein routes"),
            ("Olm Listeners",   "Cunning","Drowned Galleries"),
            ("Hidden Larder",   "Wealth", "Concealed gallery niches"),
            ("Olm Anatomist",   "Magic",  "Drowned Galleries"),
            ("Spirit Walkers",  "Magic",  "Deep pools"),
        ],
    },
]


# ---------------------------------------------------------------------------
# workbook assembly
# ---------------------------------------------------------------------------

def build_readme(wb):
    ws = wb.active
    ws.title = "README"
    ws.sheet_properties.tabColor = "1F2A44"
    title_row(ws, 1, "Worlds Without Number — Faction System / Veins of the Earth", 6)

    intro = (
        "This workbook implements the Worlds Without Number faction subsystem and pre-loads "
        "it with the principal cultures of Patrick Stuart's Veins of the Earth. Mechanics "
        "are paraphrased and intended to stand on their own at the table; consult the WWN "
        "rulebook (6.0 Factions) for the official text and edge-case rulings.")
    section_row(ws, 3, "How to use this workbook", 6)
    ws.merge_cells(start_row=4, start_column=1, end_row=4, end_column=6)
    c = ws.cell(row=4, column=1, value=intro)
    c.alignment = WRAP_TOP
    c.font = BODY
    ws.row_dimensions[4].height = 60

    sheets = [
        ("Rules", "Core faction rules: attributes, HP, treasure, turn order, combat."),
        ("Actions", "Every Action a faction can take on its turn, with cost and effect."),
        ("Assets", "Master asset catalogue (Force / Cunning / Wealth / Magic)."),
        ("Tags", "Faction tags and the modifiers they confer."),
        ("Goals", "Goals factions choose to pursue for FacXP."),
        ("Combat Tracker", "Fillable one-shot combat resolver."),
        ("Roster", "Summary line for every Veins-of-the-Earth faction."),
        ("Faction -Knotsmen", "Per-faction sheet — stats, assets, current goal, notes."),
        ("Faction -Aelf-Adal", "Per-faction sheet."),
        ("Faction -Funginids", "Per-faction sheet."),
        ("Faction -dErO", "Per-faction sheet."),
        ("Faction -Dvargir", "Per-faction sheet."),
        ("Faction -Gnonmen", "Per-faction sheet."),
        ("Faction -Substratals", "Per-faction sheet."),
        ("Faction -Deep Janeen", "Per-faction sheet."),
        ("Faction -Olm", "Per-faction sheet."),
        ("Blank Faction", "Empty per-faction sheet you can copy for new factions."),
    ]
    section_row(ws, 6, "Sheets in this workbook", 6)
    end = write_table(
        ws, 7, ["Sheet", "Purpose"], sheets, widths=[24, 80])

    section_row(ws, end + 2, "Credits", 6)
    ws.merge_cells(start_row=end + 3, start_column=1, end_row=end + 3, end_column=6)
    c = ws.cell(row=end + 3, column=1,
                value=("Faction rules: Kevin Crawford, Worlds Without Number (Sine Nomine "
                       "Publishing).  Setting & cultures: Patrick Stuart & Scrap Princess, "
                       "Veins of the Earth (Lamentations of the Flame Princess).  "
                       "Faction stat-blocks and tag effects here are interpretive — adjust to "
                       "taste."))
    c.alignment = WRAP_TOP
    c.font = ITAL
    ws.row_dimensions[end + 3].height = 60


def build_rules(wb):
    ws = wb.create_sheet("Rules")
    ws.sheet_properties.tabColor = "3E5377"
    title_row(ws, 1, "Faction Rules — quick reference", 3)
    write_table(ws, 3, ["Topic", "Rule"], RULES, widths=[26, 110])


def build_actions(wb):
    ws = wb.create_sheet("Actions")
    ws.sheet_properties.tabColor = "3E5377"
    title_row(ws, 1, "Faction Actions (1 per turn unless noted)", 4)
    write_table(ws, 3, ACTIONS_HEADERS, ACTIONS, widths=[28, 38, 70, 60])


def build_assets(wb):
    ws = wb.create_sheet("Assets")
    ws.sheet_properties.tabColor = "3E5377"
    title_row(ws, 1, "Asset Catalogue", 10)

    # write each block in turn with a section header
    row = 3
    for block_label, block in [
        ("Force Assets", FORCE_ASSETS),
        ("Cunning Assets", CUNNING_ASSETS),
        ("Wealth Assets", WEALTH_ASSETS),
        ("Magic Assets", MAGIC_ASSETS),
        ("Setting Assets — Veins of the Earth (Force)", VEINS_FORCE_ASSETS),
        ("Setting Assets — Veins of the Earth (Cunning)", VEINS_CUNNING_ASSETS),
        ("Setting Assets — Veins of the Earth (Wealth)", VEINS_WEALTH_ASSETS),
        ("Setting Assets — Veins of the Earth (Magic)", VEINS_MAGIC_ASSETS),
    ]:
        section_row(ws, row, block_label, 10)
        row += 1
        end = write_table(
            ws, row, ASSETS_HEADERS, block,
            widths=[28, 10, 7, 7, 18, 12, 12, 18, 22, 60])
        row = end + 2


def build_tags(wb):
    ws = wb.create_sheet("Tags")
    ws.sheet_properties.tabColor = "3E5377"
    title_row(ws, 1, "Faction Tags", 2)
    write_table(ws, 3, TAGS_HEADERS, TAGS, widths=[30, 100])


def build_goals(wb):
    ws = wb.create_sheet("Goals")
    ws.sheet_properties.tabColor = "3E5377"
    title_row(ws, 1, "Faction Goals & XP", 4)
    write_table(ws, 3, GOALS_HEADERS, GOALS, widths=[30, 18, 70, 14])


def build_combat(wb):
    ws = wb.create_sheet("Combat Tracker")
    ws.sheet_properties.tabColor = "C0504D"
    title_row(ws, 1, "Combat Resolver (1 attack)", 4)

    ws["A3"] = ("Fill the attacker / defender fields. The two d10 totals tell you who wins; "
                "on ties, the defender wins. Winner deals listed damage. If the defender wins "
                "and has a Counter, defender deals counter damage to the attacker.")
    ws["A3"].font = ITAL
    ws["A3"].alignment = WRAP_TOP
    ws.merge_cells("A3:D3")
    ws.row_dimensions[3].height = 36

    for i, (label, val) in enumerate(COMBAT_FIELDS, start=5):
        ws.cell(row=i, column=1, value=label).font = H3
        ws.cell(row=i, column=1).fill = ROW_FILL_A
        ws.cell(row=i, column=1).border = BORDER
        ws.cell(row=i, column=1).alignment = LEFT_TOP
        c = ws.cell(row=i, column=2, value=val)
        c.fill = ROW_FILL_B
        c.border = BORDER
        c.alignment = LEFT_TOP
        ws.cell(row=i, column=2).font = BODY
        ws.merge_cells(start_row=i, start_column=2, end_row=i, end_column=4)

    ws.column_dimensions["A"].width = 36
    ws.column_dimensions["B"].width = 24
    ws.column_dimensions["C"].width = 24
    ws.column_dimensions["D"].width = 24

    # quick formula helper rows
    notes_row = 5 + len(COMBAT_FIELDS) + 2
    ws.cell(row=notes_row, column=1, value="Helper formulae").font = H3
    ws.cell(row=notes_row + 1, column=1,
            value="Attacker total =  d10 roll + attribute rating").font = BODY
    ws.cell(row=notes_row + 2, column=1,
            value="Defender total =  d10 roll + attribute rating").font = BODY
    ws.cell(row=notes_row + 3, column=1,
            value="If Attacker total >  Defender total: attacker deals listed Damage").font = BODY
    ws.cell(row=notes_row + 4, column=1,
            value="Otherwise: defender deals listed Counter (if any) to the attacker").font = BODY


def build_roster(wb):
    ws = wb.create_sheet("Roster")
    ws.sheet_properties.tabColor = "8064A2"
    title_row(ws, 1, "Veins of the Earth — Faction Roster", 9)

    headers = ["Faction", "Tagline", "Force", "Cunning", "Wealth", "Magic",
               "Treasure", "HP", "Current Goal"]
    rows = []
    for f in VEINS_FACTIONS:
        hp = 4 + f["force"] + f["cunning"] + f["wealth"] + f["magic"]
        rows.append([
            f["name"], f["tagline"],
            f["force"], f["cunning"], f["wealth"], f["magic"],
            f["treasure"], hp, f["goal"]])
    write_table(ws, 3, headers, rows,
                widths=[22, 50, 8, 9, 8, 8, 10, 8, 60])


def build_faction_sheet(wb, faction):
    title = "Faction - " + faction["name"].replace("The ", "")
    ws = wb.create_sheet(title[:31])  # excel cap
    ws.sheet_properties.tabColor = "70AD47"
    title_row(ws, 1, faction["name"], 6)

    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=6)
    c = ws.cell(row=2, column=1, value=faction["tagline"])
    c.font = ITAL
    c.alignment = LEFT_TOP
    ws.row_dimensions[2].height = 18

    ws.merge_cells(start_row=3, start_column=1, end_row=3, end_column=6)
    c = ws.cell(row=3, column=1, value=faction["description"])
    c.font = BODY
    c.alignment = WRAP_TOP
    c.fill = NOTE_FILL
    ws.row_dimensions[3].height = 70

    # attribute block
    section_row(ws, 5, "Attributes & State", 6)
    hp = 4 + faction["force"] + faction["cunning"] + faction["wealth"] + faction["magic"]
    income = -(-(faction["wealth"] * 2 + faction["force"] + faction["cunning"]) // 4)  # ceil div
    fields = [
        ("Force",     faction["force"]),
        ("Cunning",   faction["cunning"]),
        ("Wealth",    faction["wealth"]),
        ("Magic",     faction["magic"]),
        ("HP (4 + sum of attributes)", hp),
        ("Current Treasure", faction["treasure"]),
        ("Treasure income / turn (W/2 + F/4 + C/4, round up)", income),
        ("Tier (FacXP / 8 rounded down + 1)", 1),
        ("FacXP banked", 0),
        ("Home / HQ location", faction["hq"]),
        ("Current Goal", faction["goal"]),
    ]
    rows = [[k, v] for k, v in fields]
    end = write_table(ws, 6, ["Field", "Value"], rows, widths=[44, 60])

    # tags
    section_row(ws, end + 2, "Tags", 6)
    end2 = write_table(
        ws, end + 3, ["Tag", "Effect (see Tags sheet for full text)"],
        [[t, next((te for tn, te in TAGS if tn == t), "")] for t in faction["tags"]],
        widths=[36, 80])

    # asset roster
    section_row(ws, end2 + 2, "Starting Assets", 6)
    a_rows = []
    for asset_name, atype, location in faction["assets"]:
        # try to find the canonical row
        match = next((row for row in ALL_ASSETS if row[0] == asset_name), None)
        if match:
            _, _, cost, ahp, atk, dmg, ctr, minattr, traits, _notes = match
            a_rows.append([asset_name, atype, cost, ahp, atk, dmg, ctr,
                           minattr, traits, location])
        else:
            # custom asset
            a_rows.append([asset_name, atype, "?", "?", "?", "?", "?", "—", "—", location])
    write_table(
        ws, end2 + 3,
        ["Asset", "Type", "Cost", "HP", "Attack", "Damage", "Counter",
         "Min Attr", "Traits", "Location"],
        a_rows,
        widths=[24, 10, 7, 7, 14, 10, 10, 14, 22, 30])

    # turn-tracker block
    last = end2 + 3 + len(a_rows) + 2
    section_row(ws, last, "Turn Log (fill as you play)", 6)
    log_headers = ["Turn", "Treasure +/–", "Action Taken", "Result", "Goal Progress", "Notes"]
    log_rows = [[i, "", "", "", "", ""] for i in range(1, 13)]
    write_table(ws, last + 1, log_headers, log_rows,
                widths=[6, 14, 28, 28, 22, 40])


def build_blank_faction(wb):
    ws = wb.create_sheet("Blank Faction")
    ws.sheet_properties.tabColor = "70AD47"
    title_row(ws, 1, "New Faction (copy this sheet)", 6)
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=6)
    c = ws.cell(row=2, column=1,
                value="Tagline:")
    c.font = ITAL
    c.alignment = LEFT_TOP

    ws.merge_cells(start_row=3, start_column=1, end_row=3, end_column=6)
    c = ws.cell(row=3, column=1, value="Description...")
    c.font = BODY
    c.alignment = WRAP_TOP
    c.fill = NOTE_FILL
    ws.row_dimensions[3].height = 60

    section_row(ws, 5, "Attributes & State", 6)
    fields = [
        ("Force", ""),
        ("Cunning", ""),
        ("Wealth", ""),
        ("Magic", ""),
        ("HP (4 + sum of attributes)", ""),
        ("Current Treasure", ""),
        ("Treasure income / turn", ""),
        ("Tier", ""),
        ("FacXP banked", ""),
        ("Home / HQ location", ""),
        ("Current Goal", ""),
    ]
    end = write_table(ws, 6, ["Field", "Value"], [[k, v] for k, v in fields],
                      widths=[44, 60])

    section_row(ws, end + 2, "Tags", 6)
    end2 = write_table(
        ws, end + 3, ["Tag", "Effect"],
        [["", ""] for _ in range(4)], widths=[36, 80])

    section_row(ws, end2 + 2, "Starting Assets", 6)
    blank_asset_rows = [["", "", "", "", "", "", "", "", "", ""] for _ in range(8)]
    write_table(
        ws, end2 + 3,
        ["Asset", "Type", "Cost", "HP", "Attack", "Damage", "Counter",
         "Min Attr", "Traits", "Location"],
        blank_asset_rows,
        widths=[24, 10, 7, 7, 14, 10, 10, 14, 22, 30])

    last = end2 + 3 + len(blank_asset_rows) + 2
    section_row(ws, last, "Turn Log", 6)
    write_table(ws, last + 1,
                ["Turn", "Treasure +/–", "Action Taken", "Result", "Goal Progress", "Notes"],
                [[i, "", "", "", "", ""] for i in range(1, 13)],
                widths=[6, 14, 28, 28, 22, 40])


def main():
    wb = Workbook()
    build_readme(wb)
    build_rules(wb)
    build_actions(wb)
    build_assets(wb)
    build_tags(wb)
    build_goals(wb)
    build_combat(wb)
    build_roster(wb)
    for f in VEINS_FACTIONS:
        build_faction_sheet(wb, f)
    build_blank_faction(wb)
    out = "WWN_Veins_of_the_Earth_Factions.xlsx"
    wb.save(out)
    print("wrote", out)


if __name__ == "__main__":
    main()
