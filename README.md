# WWN Faction System — Veins of the Earth

A spreadsheet implementation of the [Worlds Without Number](https://www.drivethrurpg.com/en/product/348791/worlds-without-number)
faction subsystem (Kevin Crawford, Sine Nomine Publishing), prefilled with the
principal cultures of Patrick Stuart and Scrap Princess's *Veins of the Earth*
(Lamentations of the Flame Princess).

## Files

| File | What it is |
| --- | --- |
| `WWN_Veins_of_the_Earth_Factions.xlsx` | The workbook you actually use at the table. |
| `build_workbook.py` | Generator script that produces the workbook. Edit and re-run to tweak. |

## Workbook layout

| Sheet | Contents |
| --- | --- |
| **README** | Index of sheets and credits. |
| **Rules** | Faction attributes, HP, treasure income, turn order, combat. |
| **Actions** | Every action a faction can take on its turn. |
| **Assets** | Master catalogue of Force / Cunning / Wealth / Magic assets with stats. |
| **Tags** | Faction tags (including a small set of Veins-themed homebrew tags). |
| **Goals** | Goal cards a faction can pursue for Faction XP. |
| **Combat Tracker** | A fillable one-shot combat resolver. |
| **Roster** | Summary row for every prefilled faction. |
| **Faction - …** | One sheet per Veins of the Earth faction: attributes, tags, assets, 12-turn log. |
| **Blank Faction** | Copy this sheet to add new factions of your own. |

## Veins of the Earth factions included

The Knotsmen, Aelf-Adal, Funginids, dErO, Dvargir, Gnonmen, Substratals,
Deep Janeen, and Olm.

Each faction has interpretive starting values (attributes, treasure, tags, and a
small roster of assets) suitable for sandbox play. Tweak to taste.

## Regenerating the workbook

```sh
pip install openpyxl
python3 build_workbook.py
```

## Caveats

Rules text in this workbook is paraphrased; consult the WWN rulebook for
official wording and edge cases. A handful of homebrew faction tags are clearly
marked as such on the **Tags** sheet.
