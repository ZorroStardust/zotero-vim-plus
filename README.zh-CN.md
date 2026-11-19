# Zotero Vim Plus

[English](README.md) · 简体中文 · [Español](README.es-ES.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Italiano](README.it.md) · [Deutsch](README.de.md) · [Русский](README.ru.md)

<a name="系统要求"></a>
<a name="功能"></a>

用 Vim 按键在 Zotero 里读论文、做批注、编辑富文本笔记。
支持 macOS、Linux 和 Windows 上的 **Zotero 7–10**。

[下载 XPI](https://github.com/ZorroStardust/zotero-vim-plus/releases/latest/download/zoetero-vim-plus.xpi) ·
[快速开始](docs/zh-CN/getting-started.md) ·
[文档目录](docs/README.md) ·
[发布记录](https://github.com/ZorroStardust/zotero-vim-plus/releases)

[![Zotero Vim Plus 无声演示](BriefDemoVideo.gif)](BriefDemoVideo.gif)

## 安装

下载 `zoetero-vim-plus.xpi`。在 Zotero 中打开 **工具 → 插件**，点击齿轮，
选择**从文件安装插件**，然后选中 XPI。若有提示，重启 Zotero。

打开一篇 PDF，点击页面，再按 `j` / `k` 滚动。
按 `Space` 后按 `/` 可以查快捷键。
想试试键盘高亮，见[选中文字和创建批注](docs/zh-CN/annotate-pdfs.md)。

<a name="模式"></a>
<a name="普通模式"></a>
<a name="笔记-vim-编辑器"></a>
<a name="光标模式"></a>
<a name="可视模式"></a>
<a name="插入模式"></a>
<a name="标注工作流"></a>
<a name="自定义按键绑定"></a>
<a name="设置"></a>

## 默认按键绑定

[阅读和定位 PDF](docs/zh-CN/read-pdfs.md) ·
[选文和批注](docs/zh-CN/annotate-pdfs.md) ·
[查找和整理文献](docs/zh-CN/manage-library.md) ·
[编辑 Zotero 笔记](docs/zh-CN/edit-notes.md) ·
[查找和修改快捷键](docs/zh-CN/shortcuts.md) ·
[故障排查](docs/zh-CN/troubleshooting.md)

<a name="从源码构建"></a>
<a name="架构说明"></a>
<a name="待办事项"></a>

## 开发

[从源码构建](docs/development.md#building-from-source) ·
[架构说明](docs/development.md#architecture-notes) ·
[原完整中文 README](docs/archive/README.zh-CN.md) ·
[报告问题](https://github.com/ZorroStardust/zotero-vim-plus/issues)

<a name="许可证"></a>

## 致谢与许可证

Zotero Vim Plus 源自 Alex Fink 的 [zotero-vim](https://codeberg.org/finktank/zotero-vim)。
[Zotero Neo](https://github.com/zhongyangchuwu/Zotero-Neo) 基于 Vim Plus 发展，
Vim Plus 后来也从 Neo 移植了部分功能。感谢两个项目及其贡献者。

本项目采用 [GNU Affero General Public License v3.0](LICENSE)。
