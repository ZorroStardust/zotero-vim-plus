---
lang: ja
permalink: /ja/manual.html
---
# Zotero Vim Plus ユーザーガイド

[言語一覧](../README.md) · [プロジェクト](https://github.com/ZorroStardust/zotero-vim-plus/blob/main/README.ja.md)

## インストールと言語設定

[XPI ファイル](https://github.com/ZorroStardust/zotero-vim-plus/releases/latest/download/zoetero-vim-plus.xpi)をダウンロードします。Zotero の「ツール」からプラグイン管理画面を開き、歯車メニューからファイルをインストールします。Zotero 7～10 に対応しています。日本語に切り替えるには、Zotero の設定で **Zotero Vim Plus → 一般 → 言語** を開きます。

<a id="read-pdfs"></a>

## PDF を読む

ページをクリックしてフォーカスを移します。`j` / `k` でスクロールし、`h` / `l` でページ移動します。`/` で検索し、`Enter` で確定したあと `n` / `N` で結果間を移動します。`Space f h` で目次見出し、`Space f g` で図表のキャプションを検索できます。`f` は表示中のリンクや注釈にヒントを表示します。PDF のテーマは `Space r t`、`f`、ヒント文字の順に入力して選択します。

<a id="annotate-pdfs"></a>

## 文字を選択して注釈を付ける

`v` を押してヒントを選び、テキスト範囲を指定します。`Shift+V` なら表示中の語句を入力して一致箇所を選べます。`h` / `j` / `k` / `l` で範囲を調整すると、右下に文字数が表示されます。`y` でコピー、`i` でコメント、`zy` で黄色のハイライト、`zY` で下線を付けます。Translate for Zotero を設定すると `t` で翻訳できます。`[a` / `]a` で前後の注釈に移動します。

<a id="manage-library"></a>

## 文献を探して整理する

`Space f f` でライブラリ、`Space f b` で現在のコレクションを検索します。アイテム一覧では `s` で一時選択セットへの追加・削除、`Space s s` で内容の確認ができます。`Space t a` / `Space t r` でタグを変更する前に対象を確認してください。`Space b c` で読書グループを作成し、`Space b l` で開きます。

<a id="edit-notes"></a>

## Zotero のノートを編集する

`Space n` でノートを探します。`Ctrl+k` で現在のアイテム、`Ctrl+j` で全ノートに切り替えます。`Enter` で開き、別タブで開くには `Shift+Enter` を押します。`Space r n` でリーダーのノートサイドバーの表示を切り替えます。エディターでは `Esc` で **NOTE NORMAL**、`i` で挿入モードに入り、`Esc` で戻ります。

<a id="shortcuts"></a>

## キー割り当てを確認する

現在のキーは `Space /`、プラグインの設定は `Space p` で開きます。キーが反応しない場合は、フォーカスとモードを確認してください。設定の **キー割り当て** で編集し、**キー割り当てを適用** を押すと保存されます。

<a id="troubleshooting"></a>

## トラブルシューティング

キーが反応しない場合は、フォーカスとモードを確認してください。
