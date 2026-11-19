---
lang: en
guide_key: manage-library
---
# Find and organize papers in the library

[Documentation](../README.md) · [简体中文](../zh-CN/manage-library.md)

Start in Zotero's Library tab. Click the collection tree or item list to choose
which pane the keys control.

## Browse collections and items

| Keys | Result |
| --- | --- |
| `Space w h` / `Space w w` / `Space w l` | Focus the collection tree / item list / item details |
| `j` / `k`, `gg` / `G` | Move down / up, or go to the first / last row |
| `h` / `l` in the collection tree | Collapse or go to the parent / expand or move to the item list |
| `Enter` | Move from the collection tree to the item list, or open the selected item |
| `Space o` | Open the selected item's PDF |

Press `/` in the collection tree to filter collections. Older Zotero versions
offer a collection picker for this action. Press `/` in the item list to use
Zotero's quick search. While typing there, use `Ctrl+h` / `Ctrl+l` to change
the search scope. Press `Enter` to return to the filtered list or `Esc` to
clear the query and return.

## Find a paper or copy its citation

1. Press `Space f f` to search the current library or `Space f b` to search the
   current collection. These pickers also open from the PDF reader.
2. Type part of a title, creator, year, or citation key. Use `Ctrl+h` /
   `Ctrl+l` to switch among **Title, Creator, Year**, **All Fields & Tags**,
   and **Everything**. **Everything** also searches indexed attachment text.
   Use `Ctrl+Shift+h` / `Ctrl+Shift+l` to filter by item type, such as
   references, attachments, notes, or annotations.
3. Use the arrow keys to select a result. For a paper, `Enter` reveals the item
   in Zotero and `Ctrl+o` opens it. Use `Ctrl+y` to copy the formatted citation or
   `Ctrl+Shift+y` to copy its citation key.

Use `Space b j` to switch among open tabs. Type a displayed hint or move to a
tab with the arrow keys and press `Enter`.

## Apply colored tags

Assign colors to tags in Zotero first. Focus the item list and select one or
more items in the same library. Type `t1` through `t9` for the corresponding
colored tag. If any selected item already has that tag, the shortcut removes
it from the entire selection. Otherwise, it adds the tag to all selected items.
`t0` removes all colored tags from the selection.

## Collect items for a batch edit

From the item list, press `s` to add the current
item or Zotero multi-selection to a temporary set. If all the selected items
are already in the set, `s` removes them. A colored bar marks items in the set.
The set stays in the current window when you change collections or filters.

1. Press `Space s s` to review the set, including items outside the current
   list. Press `Enter` to reveal an item or `Delete` to remove it from the set.
   Use `Space s c` back in the library to clear the whole set.
2. Press `Space t a` or `Space t r` to add or remove a tag. Press `Space c a`
   to add selected top-level items to an editable collection in the same library.
3. Check the target summary before confirming. These commands use the temporary
   set when it contains items and Zotero's current selection when it is empty.
   The colored-tag keys `t0`–`t9` always use Zotero's current selection.

## Save a reading group

A reading group is a saved list of PDF
attachments in the local Zotero profile. It survives restart.

1. Mark papers in the temporary set or use Zotero's selection with an empty set.
   Press `Space b c` to create a group or `Space b a` to add PDFs to an existing
   group. Choose one PDF for each item with multiple attachments. Items without
   an available PDF are skipped. Review the summary and confirm.
2. Press `Space b l`, choose a group, and press `Enter` to see its PDFs. Press
   `Enter` on a PDF to open it. Use `Alt+↑` / `Alt+↓` to reorder it.
3. In the group list, press `Ctrl+r` to rename a group or `Delete` to delete it
   after confirmation. Inside a group, `Delete` removes the selected PDF from
   the list. These actions leave the original Zotero items and files intact.
