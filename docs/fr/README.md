# Guide de Zotero Vim Plus

[Langues](../README.md) · [Projet](../../README.fr.md)

## Installation et langue

Téléchargez le [fichier XPI](https://github.com/ZorroStardust/zotero-vim-plus/releases/latest/download/zoetero-vim-plus.xpi). Dans Zotero, ouvrez le gestionnaire d’extensions via le menu **Outils**, puis installez le fichier depuis le menu de la roue dentée. Zotero 7 à 10 est pris en charge. Choisissez le français dans **Zotero Vim Plus → Général → Langue**, dans les paramètres de Zotero.

## Lire et annoter un PDF

Cliquez dans la page. Utilisez `j` / `k` pour défiler et `h` / `l` pour changer de page. Lancez une recherche avec `/`, validez avec `Entrée`, puis parcourez les résultats avec `n` / `N`. `Space f h` recherche dans le sommaire, `Space f g` dans les légendes des figures et tableaux, et `f` affiche des indices sur les liens et annotations visibles. Pour changer le thème du PDF, tapez `Space r t`, puis `f` et les lettres indiquées.

Appuyez sur `v` et choisissez un indice pour commencer à sélectionner. Avec `Shift+V`, saisissez un mot ou une expression visible et choisissez un résultat. Ajustez la sélection avec `h` / `j` / `k` / `l`. L’indicateur affiche le nombre de caractères sélectionnés. `y` copie, `i` ajoute un commentaire, `zy` surligne en jaune et `zY` souligne. `t` traduit la sélection si Translate for Zotero est configuré. `[a` / `]a` parcourt les annotations.

## Organiser la bibliothèque et écrire des notes

Recherchez dans la bibliothèque avec `Space f f` ou dans la collection actuelle avec `Space f b`. Dans la liste des documents, `s` ajoute ou retire des éléments de la sélection temporaire. Vérifiez-la avec `Space s s` avant de modifier les étiquettes avec `Space t a` ou `Space t r`. Créez un groupe de lecture avec `Space b c` et ouvrez-le avec `Space b l`.

Ouvrez le sélecteur de notes avec `Space n`. `Ctrl+k` affiche les notes du document courant et `Ctrl+j` toutes les notes. `Entrée` ouvre la note et `Shift+Entrée` l’ouvre dans un nouvel onglet. `Space r n` affiche ou masque le panneau de notes du lecteur. Dans l’éditeur, `Esc` active **NOTE NORMAL**, `i` permet d’écrire et `Esc` ramène au mode normal.

## Consulter et modifier les raccourcis

`Space /` affiche les raccourcis actifs et `Space p` ouvre les réglages. Si une touche ne répond pas, vérifiez le mode et le panneau actif. Pour modifier les touches, ouvrez **Raccourcis**, puis cliquez sur **Appliquer les raccourcis**.
