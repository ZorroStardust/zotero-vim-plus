# Insert 模式（批注评论编辑）设计笔记

> 记录 `i` / Enter 进入批注评论编辑的完整演进过程、发现的根因与最终设计。
> 供后续维护者参考——避免重走一遍焦点战争的老路。

## 环境事实（由日志 + Zotero 9 源码确认）

- Zotero 9 的 reader 是三层结构：chrome 窗口 → `<browser>`（reader.html）→ PDF.js iframe。
- **OS 级键盘焦点几乎永远停留在 PDF.js iframe 窗口**（所有按键事件都从那里进来）。
- **程序化 `window.focus()` / `el.focus()` 移动不了 OS 键盘焦点**——日志证据：
  `document.hasFocus()` 与 `activeElement` 都报告成功，但按键依然全部落在 PDF
  窗口。只有**真实的用户点击**能移动 OS 键盘焦点（Gecko 焦点安全模型）。
- Zotero 的 FocusManager（window 级 focusin）会在焦点落入白名单之外的元素时
  触发 `onDeselectAnnotations` → 选中同步 → 关闭批注气泡；其 KeyboardManager
  在特定状态下会用 Backspace 删除整个批注。
- 侧栏评论框只有在恰好选中一个批注时才可编辑；气泡评论框永远可编辑。

## 演进史（每轮失败学到的东西）

1. **聚焦侧栏/气泡评论框**：失败——焦点拿不到（OS 焦点固定在 PDF 窗口）。
2. **watchdog 反复聚焦**：制造了 "focusin → 取消选中 → 关气泡 → 重开" 的
   闪烁死循环；`window.focus()` 还会让 Gecko 把 activeElement 恢复成 PDF
   iframe，刚聚焦的编辑框立即失焦。
3. **按键陷阱（trap）**：PDF 窗口的 keydown 监听器一定能收到按键 →
   手动写入编辑框 DOM + 合成 input 事件走 Zotero 保存链。ASCII 可行，
   但中文输入法需要真实可编辑焦点，且写 DOM 与 React clean() 互相打架
   （光标错乱、退格连删）。
4. **隐藏 textarea 通道（conduit）**：放在 reader 文档→失败（无 OS 焦点 +
   focusin 取消选中）；放进 PDF 文档→中文可用，但通道被清空/定位样式每
   200ms 改写、组合目标漂移、孤儿组合楔死输入法——复杂度失控。
5. **原生聚焦尝试**：程序化聚焦"成功"但按键仍进 PDF 窗口——不可行（见上）。

## 最终设计：插件自有浮窗（纯键盘，脱离 Zotero 气泡）

**核心思路**：既然按键永远落在 PDF 窗口，就把**真正的输入框**放进 PDF
窗口——一个可见的、插件自有的浮窗 `<textarea>`（不再隐藏、不再转发、
不再清空）。用户直接在其中输入（ASCII + 中文输入法全原生），Esc 保存
为官方批注评论（`item.annotationComment = value; item.saveTx()`）。

### 主路径（`_enterAnnotationInsertMode`）

1. 解析目标批注 key（`lastAnnotationKey` → Zotero 的 `selectedAnnotationIDs[0]`）。
2. `navigate({annotationID})`：滚动到批注并显示选中框（**不打开 Zotero 气泡**）。
3. 创建浮窗（`_createAnnotationCommentOverlay`，渲染在 `pdfWin.document`）：
   底部中央、可选引用行（批注高亮原文截断）+ 多行 textarea（预填现有评论，
   光标置末尾）+ 提示行（Enter 换行 · Esc 保存关闭）。
4. 温和 watchdog（500ms，会话令牌）：仅当 textarea 失焦且不在输入法组合中
   时才重新聚焦；**绝不改写样式或值**。
5. Enter = 原生换行；Escape = 保存 + 关闭 + 回 normal；2 秒防抖自动保存兜底。

### 输入与保存

- 输入全原生（textarea 在 PDF 文档内直接接收按键与 IME 组合）；
- 保存链：`Zotero.Items.get()` **只接受数字 ID**——传入批注 key 会静默
  返回 `false`（曾导致预填空、假"已保存"）。正确路径是先
  `Zotero.Items.get(reader.itemID)`（附件，数字 ID）再
  `attachment.getAnnotations().find(a => a.key === key)`（必要时
  `await item.loadDataType('annotation')`）；进入 insert 时把
  `item.id` / `item.libraryID` 暂存到 state，保存时走数字 ID 同步缓存 +
  `getByLibraryAndKeyAsync` 兜底。`saveTx()` 后 Zotero 通知机制会自动
  同步侧栏/气泡的显示；
- `_readerConsumesKey` 继续吞掉单字符/退格/Delete/Enter 的转发副本，
  防止 Zotero 键盘管理器的副作用（`s` 切指针工具、退格删批注）；
- visual `i`（addNote）创建批注后直接进入同一浮窗。

### 关键防护

- 会话令牌（`_insertSessionID`）：每次进入 insert 自增，旧 watchdog 链
  检测到令牌变化立即终止。
- 组合状态（`state._composing`）：由浮窗 textarea 自身的
  compositionstart/end 维护，watchdog 组合期间完全不干预。
- **Zotero 9 Enter 拦截（`_patchReaderTextAnnotationFocus`）**：Zotero 9
  的 `PdfView._handleKeyDown()` 是 iframe 窗口上的绑定 capture 监听器，
  注册早于插件、且**在调用 `view._onKeyDown` 之前**直接处理 Enter
  （`_selectedAnnotationIDs.length === 1` 时 `_openAnnotationPopup()` +
  `preventDefault()`——既弹气泡又吃掉原生换行；`Shift-Enter` 不匹配所以
  无此问题）。它的早退条件是动态调用的 `this._textAnnotationFocused()`，
  因此插件把该方法包成：浮窗 textarea 获得焦点时返回 true → Zotero 的
  全部按键/指针处理直接早退，Enter 变为原生换行、不开气泡、不转发
  KeyboardManager。
- 气泡守卫（`_armAnnotationPopupGuard`）：若气泡仍意外弹出（例如焦点
  短暂离开 textarea 时按 Enter），MutationObserver 检测到后向其编辑器
  派发 Escape 立即关闭——`_textAnnotationFocused` 补丁之外的兜底。
- **原生编辑框交接（`_handOverAnnotationInsert`）**：reader.html 的
  focusin（capture）监听器检测到焦点落入原生可编辑元素（气泡评论
  编辑器、侧栏评论框）且 insert 会话激活时：立即 `_setMode('normal')`
  杀掉 watchdog（防止抢焦），异步保存并关闭浮窗、解除气泡守卫，
  **不抢回 PDF 焦点**——原生编辑面完整接管。进入 insert 前暂存的
  `ir._enableAnnotationDeletionFromComment` 原值在 Esc 退出/交接/reader
  cleanup 时恢复；原生编辑器内的 Escape 完全交还 Zotero（旧的
  outerEscapeHandler 已删除）。

## 已知限制

- 浮窗是插件自绘 UI，样式不跟随 Zotero 主题（当前为深色固定样式，
  后续可加浅色适配）。
- 用户主动点开 Zotero 自己的气泡/侧栏编辑框时，插件浮窗保存并关闭、
  交接给原生编辑（不会出现两个输入面并存）；之后按 `i` 可重新打开
  浮窗。
