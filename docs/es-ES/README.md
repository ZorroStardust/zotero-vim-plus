---
lang: es-ES
permalink: /es-ES/manual.html
---
# Guía de Zotero Vim Plus

[Idiomas](../README.md) · [Proyecto](https://github.com/ZorroStardust/zotero-vim-plus/blob/main/README.es-ES.md)

## Instalar y configurar

Descarga el [archivo XPI](https://github.com/ZorroStardust/zotero-vim-plus/releases/latest/download/zoetero-vim-plus.xpi). En Zotero, abre **Herramientas → Complementos**, haz clic en el engranaje e instala el archivo. El complemento es compatible con Zotero 7–10. Elige **Español** en **Ajustes → Zotero Vim Plus → General**.

<a id="read-pdfs"></a>

## Leer y recorrer PDF

Haz clic en la página. Usa `j` / `k` para desplazarte, `h` / `l` para cambiar de página y `/` para buscar. Confirma con `Enter` y recorre los resultados con `n` / `N`. Usa `Space f h` para buscar títulos del índice, `Space f g` para pies de figuras y tablas, y `f` para mostrar pistas sobre enlaces y anotaciones visibles. Para cambiar el tema del PDF, pulsa `Space r t`, luego `f` y escribe la pista.

<a id="annotate-pdfs"></a>

## Seleccionar y anotar

Pulsa `v` y elige una pista para iniciar la selección. Con `Shift+V` puedes escribir texto visible y elegir una coincidencia. Ajusta la selección con `h` / `j` / `k` / `l`. El indicador muestra el número de caracteres. Usa `y` para copiar, `i` para comentar, `zy` para resaltar en amarillo o `zY` para subrayar. `t` traduce mediante Translate for Zotero si está configurado. Usa `[a` / `]a` para ir a otras anotaciones.

<a id="manage-library"></a>

## Buscar y organizar artículos

Busca en la biblioteca con `Space f f` o en la colección actual con `Space f b`. En la lista de ítems, `s` añade o quita los ítems seleccionados de la selección temporal. Revísala con `Space s s`, sobre todo antes de editar etiquetas con `Space t a` o `Space t r`. Crea un grupo de lectura con `Space b c` y ábrelo con `Space b l`.

<a id="edit-notes"></a>

## Editar notas de Zotero

Abre el selector de notas con `Space n`. Usa `Ctrl+k` para las notas del ítem actual y `Ctrl+j` para todas. `Enter` abre la nota y `Shift+Enter` la abre en otra pestaña. `Space r n` muestra u oculta la barra de notas del lector. En el editor, pulsa `Esc` para entrar en **NOTE NORMAL**, `i` para escribir y `Esc` para volver.

<a id="shortcuts"></a>

## Consultar atajos

Pulsa `Space /` para consultar las teclas activas o `Space p` para abrir los ajustes. Para modificar las asignaciones, abre **Atajos** y pulsa **Aplicar atajos** al terminar.

<a id="troubleshooting"></a>

## Resolver problemas

Si una tecla no responde, comprueba qué panel tiene el foco y en qué modo estás.
