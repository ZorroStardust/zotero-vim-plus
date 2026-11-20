# Zotero Vim Plus

[English](README.md) · [简体中文](README.zh-CN.md) · [Español](README.es-ES.md) · 日本語 · [한국어](README.ko.md) · [Français](README.fr.md) · [Italiano](README.it.md) · [Deutsch](README.de.md) · [Русский](README.ru.md)

Vim 風のキー操作で論文を読み、PDF に注釈を付け、Zotero のリッチテキストノートを編集できます。
macOS、Linux、Windows の **Zotero 7～10** に対応しています。

[Zotero Vim Plus の公式サイト](https://zorrostardust.github.io/zotero-vim-plus/ja/)では、デモの視聴、プラグインのダウンロード、9 言語のガイドの閲覧ができます。

[XPI をダウンロード](https://github.com/ZorroStardust/zotero-vim-plus/releases/latest/download/zoetero-vim-plus.xpi) ·
[クイックスタート](docs/ja/README.md) ·
[ドキュメント一覧](docs/README.md) ·
[リリース](https://github.com/ZorroStardust/zotero-vim-plus/releases)

[![Zotero Vim Plus の無音デモ](https://zorrostardust.github.io/zotero-vim-plus/assets/demo/ja.gif)](https://zorrostardust.github.io/zotero-vim-plus/assets/demo/ja.gif)

## インストール

`zoetero-vim-plus.xpi` をダウンロードします。Zotero の **ツール → プラグイン** を開き、
歯車メニューからファイルを指定してインストールします。求められた場合は Zotero を再起動してください。

PDF を開いてページをクリックし、`j` / `k` でスクロールします。`Space` の後に `/` を押すと、
キー割り当てを確認できます。最初のハイライトを付けるには、[注釈のガイド](docs/ja/README.md#annotate-pdfs)を参照してください。

## ユーザーガイド

[PDF を読む・移動する](docs/ja/README.md#read-pdfs) ·
[文字を選択して注釈を付ける](docs/ja/README.md#annotate-pdfs) ·
[文献を探して整理する](docs/ja/README.md#manage-library) ·
[Zotero のノートを編集する](docs/ja/README.md#edit-notes) ·
[キー割り当てを確認・変更する](docs/ja/README.md#shortcuts) ·
[トラブルシューティング](docs/ja/README.md#troubleshooting)

## 開発

[ソースからビルドする](docs/development.md#building-from-source) ·
[アーキテクチャの説明](docs/development.md#architecture-notes) ·
[以前の完全版 README（英語）](docs/archive/README.md) ·
[問題を報告する](https://github.com/ZorroStardust/zotero-vim-plus/issues)

## 謝辞とライセンス

Zotero Vim Plus は Alex Fink の [zotero-vim](https://codeberg.org/finktank/zotero-vim) をフォークしたプロジェクトです。
[Zotero Neo](https://github.com/zhongyangchuwu/Zotero-Neo) は Vim Plus を基に開発され、その一部の機能は Vim Plus にも取り込まれています。
両プロジェクトとその貢献者に感謝します。

ライセンスは [GNU Affero General Public License v3.0](LICENSE) です。
