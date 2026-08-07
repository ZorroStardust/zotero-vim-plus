# Zotero Vim Plus

> **Idiomas:** [English](README.md) · [Español](README.es-ES.md)

> Repositorio original: https://codeberg.org/finktank/zotero-vim
>
> Este repositorio es una bifurcación del proyecto original Zotero Vim.

Atajos de teclado al estilo Vim para el lector de PDF de Zotero 7/8. Navega, desplázate,
anota y copia texto sin necesidad de usar el ratón.

Programado con emoción por Claude Sonnet 4.5.

![Vídeo de demostración breve (sin audio)](BriefDemoVideo.gif)

---

## Índice

- [Características](#características)
- [Requisitos](#requisitos)
- [Instalación](#instalación)
- [Compilación desde el código fuente](#compilación-desde-el-código-fuente)
- [Modos](#modos)
- [Atajos de teclado predeterminados](#atajos-de-teclado-predeterminados)
  - [Modo normal](#modo-normal)
    - [Modo cursor](#modo-cursor)
  - [Modo visual](#modo-visual)
  - [Modo inserción](#modo-inserción)
- [Flujo de trabajo de anotación](#flujo-de-trabajo-de-anotación)
- [Tareas pendientes](#tareas-pendientes)
- [Personalización de atajos de teclado](#personalización-de-atajos-de-teclado)
- [Configuración](#configuración)
- [Notas sobre la arquitectura](#notas-sobre-la-arquitectura)

---

## Características

- **Modo normal**: desplazar, navegar por páginas, saltar entre anotaciones, copiar texto de anotaciones, eliminar anotaciones, reposicionar la vista (zt/zz/zb) y desplazarse horizontalmente al hacer zoom (`Shift+h`/`Shift+l`).
- **Modo cursor**: mover un cursor de texto como los plugins Vim del navegador sin seleccionar texto (`hjkl`, `w/W`, `b/B`, `0/$`, y prefijos de conteo como `2w`).
- **Modo visual**: construir selecciones de texto por línea, carácter, palabra, oración o párrafo; crear resaltados o notas de color; copiar la selección o todo el párrafo al portapapeles.
- **Modo inserción**: pasar temporalmente todas las teclas a Zotero (útil al escribir en campos de formulario); también enfoca el campo de comentario de anotación cuando se selecciona una anotación.
- **Totalmente remapable**: cada acción puede ser reasignada desde el panel de preferencias.
- **Sin colisiones de atajos**: las teclas consumidas por vim se interceptan antes del manejo de teclado del lector de Zotero, así `l` (página siguiente) no dispara la lectura en voz alta incorporada y `h`/`s`/`Ctrl+F` no alternan la herramienta de mano / herramienta de puntero / barra de búsqueda.
- **Postprocesamiento de texto**: todas las operaciones de yank normalizan las ligaduras Unicode (`ﬁ` → `fi`, etc.) y colapsan los saltos de línea de separación de PDF en espacios.

---

## Requisitos

- Zotero 7, 8 o 9 (el plugin utiliza la API de arranque de Zotero 7+).
- macOS, Linux o Windows.

---

## Instalación

1. Descarga `zotero-vim-plus.xpi` desde la página de lanzamientos (o compílalo tú mismo — ver más abajo).
2. Abre Zotero.
3. Ve a **Herramientas → Plugins**.
4. Haz clic en el **icono de engranaje (⚙)** en la esquina superior derecha de la ventana de Plugins.
5. Elige **Instalar plugin desde archivo…** y selecciona `zotero-vim-plus.xpi`.
6. Reinicia Zotero cuando se te solicite.

Para actualizar, repite los mismos pasos con el nuevo `.xpi`. Zotero reemplazará la versión antigua automáticamente.

---

## Compilación desde el código fuente

```bash
git clone https://github.com/ZorroStardust/zotero-vim-plus.git
cd zotero-vim-plus
./build.sh
```

`build.sh` comprime el código fuente del plugin en `zoetero-vim-plus.xpi`. No se
necesitan herramientas de compilación ni gestores de paquetes — solo `zip`
(disponible por defecto en macOS y la mayoría de distribuciones Linux). Si
`node` está disponible, el script también verifica la sintaxis de los archivos
JS y que las tablas de atajos (zoteroVim.js vs prefs.js) estén sincronizadas.

```
zotero-vim-plus/
├── manifest.json          Manifest del plugin (ID, versión, rango de versión de Zotero)
├── bootstrap.js           Controles de ciclo de vida (inicio/apagado/eventos de ventana)
├── build.sh               Compila zoetero-vim-plus.xpi (más comprobaciones de cordura)
├── content/
│   ├── zoteroVim.js       Núcleo: modos, manejo de teclas, despachador de acciones
│   ├── zoteroVimReader.js Métodos del lector (esquema, visual/cursor, anotaciones)
│   ├── zoteroVimMain.js   Métodos de ventana principal (editor de notas, selectores, diseño de notas)
│   ├── preferences.xhtml  Interfaz de usuario del panel de preferencias (híbrido XUL/HTML)
│   └── prefs.js           JS del panel de preferencias (lee/escribe preferencias de Firefox)
├── tools/
│   └── check-sync.js      Verifica que las tablas de atajos sigan sincronizadas
└── icons/
    ├── icon-64x64.png     Icono del plugin (panel de preferencias, manifest)
    ├── icon-128x128.png   Icono del plugin (manifest)
    ├── zotero vim plus.svg  Fuente vectorial del logotipo
    ├── vim.svg            Icono heredado (conservado por compatibilidad)
    ├── vim-48.png
    └── vim-96.png
```

---

## Modos

El plugin opera en cuatro modos, mostrados en una pequeña superposición en la esquina inferior derecha del visor de PDF:

| Modo | Indicador | Propósito |
|------|-----------|---------|
| **Normal** | *(oculto)* | Predeterminado — comandos de navegación y anotación |
| **Cursor** | `-- CURSOR --` | Navegación de cursor sin selección de texto |
| **Visual** | `-- VISUAL --` | Selección de texto y creación de anotaciones |
| **Insert** | `-- INSERT --` | Passthrough — todas las teclas van a Zotero |

Transiciones de modo:

```
Normal ──c──▶ Cursor ──Escape────▶ Normal
Normal ──v──▶ Visual ──v/Escape──▶ Normal
Normal ──i──▶ Insert ──Escape────▶ Normal
Cursor ──v──▶ Visual ──v/Escape──▶ Normal
```

---

## Atajos de teclado predeterminados

### Modo normal

#### Desplazamiento

| Tecla | Acción |
|-----|--------|
| `j` | Desplazar hacia abajo |
| `k` | Desplazar hacia arriba |
| `Shift+h` (`H`) | Desplazar hacia la izquierda |
| `Shift+l` (`L`) | Desplazar hacia la derecha |
| `Ctrl+d` | Desplazar media página hacia abajo |
| `Ctrl+u` | Desplazar media página hacia arriba |
| `Ctrl+f` | Desplazar página completa hacia abajo |
| `Ctrl+b` | Desplazar página completa hacia arriba |

Los prefijos de conteo multiplican el paso — `3j` desplaza tres pasos,
`2ctrl+f` dos páginas completas, y así sucesivamente.

#### Navegación por páginas

| Tecla | Acción |
|-----|--------|
| `h` | Página anterior |
| `l` | Página siguiente |
| `gg` | Primera página |
| `G` | Última página |
| `Shift+J` (`J`) | Cambiar a la pestaña abierta anterior |
| `Shift+K` (`K`) | Cambiar a la siguiente pestaña abierta |
| `<space>bj` | Abrir el selector de pestañas (salto basado en pistas a una pestaña abierta) |
| `<space>n` | Abrir la superposición de diseño de notas (izquierda: lista de títulos de notas, derecha: vista previa de nota) |

Los prefijos de conteo repiten el cambio de página (`3l` = tres páginas
adelante) y `gg`/`G` con conteo saltan a ese número de página (`5G` / `5gg` =
página 5).

> **Nota:** la lectura en voz alta incorporada de Zotero también escucha las
> teclas `l`/`r`. El plugin bloquea el reenvío de teclado del lector de Zotero
> para las teclas que vim consume, así que `l` (página siguiente) nunca inicia
> la lectura en voz alta. Para usarla, presiona `r` (sin enlazar por defecto)
> o haz clic en el botón de la barra de herramientas.

#### Selector difuso

| Tecla | Acción |
|-----|--------|
| `<space>ff` | Abrir selector difuso sobre todos los elementos de la biblioteca actual |
| `<space>fb` | Abrir selector difuso sobre los elementos de la colección actual |
| `<space>bj` | Abrir selector de pestañas (ver abajo) |

El selector abre una caja de búsqueda en el centro de la pantalla. Empieza a
escribir para filtrar elementos (coincidencia difusa secuencial — cada
carácter debe aparecer en orden). Luego:

| Tecla | Acción |
|-----|--------|
| `↑` / `↓` (o `Ctrl+n` / `Ctrl+p`, `Ctrl+j` / `Ctrl+k`) | Mover la selección hacia arriba / abajo |
| `Enter` | Seleccionar el elemento en la lista de elementos / saltar a la pestaña seleccionada |
| `y` | Copiar la cita completa del elemento seleccionado al portapapeles |
| `yy` | Copiar la citekey del elemento seleccionado al portapapeles |
| `Escape` | Cerrar el selector |

El **selector de pestañas** (`<space>bj`) usa la misma interfaz para las
pestañas abiertas actualmente, más **letras de pista**: cada pestaña muestra
una etiqueta de letra, y escribir su(s) letra(s) selecciona esa pestaña
directamente (pistas de una o dos letras según el número de pestañas). La
copia `y`/`yy` no está disponible en el selector de pestañas.

#### Superposición de diseño de notas

El lado izquierdo muestra entradas de notas (solo título), agrupadas en "Notas del elemento actual" y "Todas las notas".
El lado derecho muestra el contenido de vista previa de la nota seleccionada.
Si la pestaña actual es un lector de PDF, abrir una nota desde esta superposición preferirá el editor de notas lateral de Zotero para que puedas leer y editar lado a lado.

| Tecla | Acción |
|-----|--------|
| `j` / `k` | Mover el foco de notas hacia abajo / arriba |
| `Ctrl+d` / `Ctrl+u` | Movimiento rápido hacia abajo / arriba en la lista de notas |
| `Ctrl+j` / `Ctrl+k` | Cambiar entre las secciones "Notas del elemento actual" y "Todas las notas" en la lista izquierda |
| `Ctrl+l` | Mover el foco al panel de vista previa derecho |
| `Ctrl+h` | Mover el foco de vuelta a la lista de notas izquierda |
| `n` | Crear una nueva nota hija bajo el elemento padre de la nota seleccionada y abrirla en el editor de notas lateral |
| `Shift+N` | Crear una nueva nota hija bajo el elemento seleccionado actualmente y abrirla en una nueva pestaña de nota |
| `gg` / `G` | Saltar a la primera / última nota en la superposición |
| Letras de pista | Enfoque rápido por etiqueta de pista (simple o doble key) |
| `Enter` | Abrir la nota seleccionada en el editor de notas lateral (pestañas de lector preferidas) |
| `Shift+Enter` | Abrir la nota seleccionada en una nueva pestaña de nota |
| `Escape` | Cerrar la superposición de diseño de notas |

#### Explorador de esquema

| Tecla | Acción |
|-----|--------|
| `<space>e` | Alternar la superposición personalizada de explorador de esquema |
| `j` / `k` | Mover la selección de esquema hacia abajo / arriba |
| `Ctrl+d` / `Ctrl+u` | Movimiento rápido hacia abajo / arriba |
| `l` | Expandir el nodo de esquema seleccionado |
| `h` | Colapsar el nodo de esquema seleccionado |
| `R` / `M` | Expandir todos / colapsar todos los nodos de esquema |
| `gg` / `G` | Saltar al principio / final del elemento de esquema |
| Letras de pista | Seleccionar el elemento de esquema indicado sin saltar |
| `Enter` | Saltar al elemento de esquema seleccionado y volver al modo Normal |
| `Escape` | Cerrar el explorador de esquema |

Cuando el explorador de esquema se abre, intentará preseleccionar el elemento de esquema más cercano o actual para tu posición de lectura; si los metadatos del PDF no permiten un mapeo confiable, se cae al primer elemento de esquema visible. Cada elemento visible también muestra una etiqueta de pista.
Si el número de elementos es pequeño, las pistas son caracteres simples; de lo contrario, se expanden a pistas de dos caracteres. Escribir una pista solo cambia la selección actual; aún debes presionar `Enter` para saltar.

#### Vista dividida del lector

| Tecla | Acción |
|-----|--------|
| `<space>-` | Alternar división horizontal (arriba/abajo) |
| `<space>\|` | Alternar división vertical (izquierda/derecha) |
| `Ctrl+h` | Volver desde el editor de notas lateral a la ventana activa del lector; de lo contrario, enfocar el panel dividido a la izquierda |
| `Ctrl+j` | Enfocar el panel dividido debajo (o alternar panel en división vertical) |
| `Ctrl+k` | Enfocar el panel dividido encima (o alternar panel en división vertical) |
| `Ctrl+l` | En división vertical, moverse al panel derecho del lector primero y luego al editor de notas lateral; de lo contrario, enfocar el panel dividido a la derecha |

#### Editor de notas (panel de contexto y pestaña de nota independiente)

Cuando un editor de notas de Zotero tiene el foco (panel de contexto lateral o una pestaña de nota independiente), el plugin proporciona una capa mínima al estilo Vim.

| Tecla | Acción |
|-----|--------|
| `i` | Entrar en modo Insertar de notas (pasar escritura) |
| `a` / `A` / `I` | Entrar en modo Insertar en el siguiente carácter / final de línea / inicio de línea |
| `o` / `O` | Abrir línea debajo / encima y entrar en modo Insertar |
| `Escape` | Volver al modo Normal de notas |
| `h` / `l` | Mover cursor hacia la izquierda / derecha |
| `j` / `k` | Mover cursor hacia abajo / arriba línea |
| `w` / `e` / `b` | Mover por palabra (adelante inicio / adelante fin / atrás) |
| `W` / `E` / `B` | Variantes de big-palabra |
| `0` / `^` / `$` | Mover al inicio de línea / primer no-blanco (aproximado) / fin de línea |
| `gg` | Saltar a la primera línea |
| `G` | Saltar a la última línea |
| `3j` (ejemplo) | Prefijo de conteo para movimientos (repetir 3 veces) |
| `3G` / `12gg` | Prefijo de conteo para saltar a una línea específica |
| `x` | Eliminar carácter en cursor |
| `dd` | Eliminar línea actual |
| `yy` | Copiar línea actual al portapapeles |
| `dw` / `de` / `db` / `d$` | Eliminar por movimiento (palabra/palabra-fin/antes-palabra/hasta fin de línea) |
| `yw` / `ye` / `yb` / `y$` | Copiar por movimiento |
| `cw` / `ce` / `c$` | Cambiar por movimiento (eliminar rango y entrar en modo Insertar) |
| `diw` / `yiw` / `ciw` | Texto interior de palabra (eliminar/copiar/cambiar) |
| `p` / `P` | Pegar último texto copiado/eliminado después / antes del cursor |
| `u` / `Ctrl+r` | Puente de deshacer / rehacer |
| `<space>...` | Los atajos de ventana principal están disponibles en modo Normal de notas (por ejemplo `<space>n`, `<space>ff`) |
| `Shift+J` / `Shift+K` | Cambiar a la pestaña anterior / siguiente desde el modo Normal de notas |

`dd`, `yy` y `x` admiten prefijos de conteo (por ejemplo `3dd`, `5yy`, `4x`).
Los combos de operador+movimiento también admiten conteos (por ejemplo `3dw`, `2y$`).
`p` y `P` usan el registro interno de notas del plugin (actualizado por `yy` y `dd`).

#### Navegación por árbol de biblioteca (panel izquierdo)

Estos atajos actúan sobre el panel izquierdo nativo de Zotero (árbol de
colecciones y lista de elementos) cuando ese panel tiene el foco.

| Tecla | Acción |
|-----|--------|
| `j` / `k` | Mover la selección hacia abajo / arriba (árbol de colecciones y lista de elementos) |
| `gg` / `G` | Saltar a la primera / última fila |
| `h` | En la lista de elementos, mover el foco de vuelta al árbol de colecciones; en el árbol de colecciones, colapsar colección seleccionada o saltar a padre |
| `l` | En el árbol de colecciones, expandir colección seleccionada; si ya expandida o hoja, mover el foco al interior de la lista de elementos |
| `Enter` | En el árbol de colecciones, mover el foco al interior de la lista de elementos; en la lista de elementos, abrir el elemento/PDF seleccionado |
| `Backspace` | Saltar a colección padre |
| `za` | Alternar expandir/colapsar para la fila de colección seleccionada actualmente |
| `zo` | Expandir fila de colección actual (si ya abierta, mantener abierta) |
| `zc` | Colapsar fila de colección actual (si ya cerrada, mantener cerrada) |
| `R` | Expandir todas las colecciones en el árbol de biblioteca actual |
| `M` | Colapsar todas las colecciones en el árbol de biblioteca actual |

#### Acordes `<space>` de ventana principal

Estos atajos funcionan en la ventana principal de Zotero (no dentro del
lector), sobre lo que tenga el foco:

| Tecla | Acción |
|-----|--------|
| `<space>ff` | Selector difuso sobre todos los elementos de la biblioteca actual |
| `<space>fb` | Selector difuso sobre los elementos de la colección actual |
| `<space>bj` | Abrir selector de pestañas |
| `<space>n` | Alternar superposición de diseño de notas |
| `<space>e` | Enfocar el árbol de colecciones |
| `<space>yy` | Copiar la citekey del elemento seleccionado al portapapeles |
| `<space>o` | Abrir el PDF del elemento seleccionado |
| `<space>q` | Cerrar la pestaña de PDF activa |
| `<space>/` | Enfocar la barra de búsqueda de Zotero |
| `<space>wh` | Enfocar el árbol de colecciones (panel izquierdo) |
| `<space>wl` | Enfocar el panel de detalles (panel derecho) |
| `<space>ww` | Enfocar la lista de elementos (panel central) |

#### Posicionamiento de vista (como los comandos z de Vim)

| Tecla | Acción |
|-----|--------|
| `zt` | Desplazar para que la página actual esté en el **tope** de la vista |
| `zz` | Desplazar para que la página actual esté en el **centro** de la vista |
| `zb` | Desplazar para que la página actual esté en el **fondo** de la vista |

#### Búsqueda

| Tecla | Acción |
|-----|--------|
| `/` | Abrir la barra de búsqueda de PDF |
| `n` | Saltar al siguiente resultado de búsqueda |
| `N` | Saltar al resultado de búsqueda anterior |
| `Escape` | Borrar / cerrar búsqueda |

La búsqueda funciona como en Vim: presiona `/` para abrir la barra de
búsqueda de Zotero, escribe tu consulta (los resultados se resaltan mientras
escribes), luego presiona `Enter` — el foco vuelve al PDF automáticamente y
`n` / `N` recorren los resultados mientras el contador sigue visible.
Presiona `/` de nuevo para reabrir la barra con tu consulta anterior
seleccionada. `Escape` cierra la barra de búsqueda y borra los resaltados.
Presionar `n` / `N` sin una búsqueda activa muestra una pista de buscar
primero.

#### Filtro lateral por color

| Tecla | Acción |
|-----|--------|
| `Zy` | Filtrar barra lateral → Solo anotaciones amarillas |
| `Zr` | Filtrar barra lateral → Solo anotaciones rojas |
| `Zg` | Filtrar barra lateral → Solo anotaciones verdes |
| `Zb` | Filtrar barra lateral → Solo anotaciones azules |
| `Zp` | Filtrar barra lateral → Solo anotaciones moradas |
| `Za` | Borrar filtro de color (mostrar todas las anotaciones) |

> **Consejo:** `z` (minúscula) actúa *sobre* una anotación (recolorar). `Z` (mayúscula) actúa *sobre la vista de barra lateral* (filtrar).

#### Navegación y edición de anotaciones

Usa `[` y `]` para moverte entre anotaciones. La anotación seleccionada se resalta en el visor de PDF y la barra lateral se desplaza a su tarjeta.

| Tecla | Acción |
|-----|--------|
| `[` | Saltar a anotación anterior |
| `]` | Saltar a anotación siguiente |
| `Enter` | Abrir el campo de comentario de la anotación seleccionada para editar |
| `i` | Entrar en modo Insertar **y** enfocar el campo de comentario de la anotación |
| `y` | Copiar el **texto resaltado** de la anotación al portapapeles |
| `yy` | Copiar el **texto del comentario** de la anotación al portapapeles |
| `dd` | Eliminar la anotación seleccionada |
| `zy` | Cambiar color de anotación → Amarillo |
| `zr` | Cambiar color de anotación → Rojo |
| `zg` | Cambiar color de anotación → Verde |
| `zb` | Cambiar color de anotación → Azul |
| `zp` | Cambiar color de anotación → Morado |

> **Consejo:** `y` vs `yy` — el plugin espera hasta 800 ms para el segundo `y` antes de ejecutar la acción de `y` único. Escribir `yy` rápidamente siempre gana.

#### Cambios de modo

| Tecla | Acción |
|-----|--------|
| `v` | Entrar en modo Visual |
| `c` | Entrar en modo Cursor |
| `i` | Entrar en modo Insertar |

---

### Modo cursor

Entra en modo Cursor con `c` desde el modo Normal.
Después de presionar `c`, el plugin muestra insignias de pista (mismo estilo visual que modo Visual) en posiciones de texto candidatas en el viewport. Presiona una letra de pista para colocar el cursor allí.

#### Movimiento del cursor

| Tecla | Acción |
|-----|--------|
| `j` / `k` | Mover cursor hacia abajo / arriba una línea visual |
| `h` / `l` | Mover cursor hacia la izquierda / derecha un carácter |
| `w` | Mover cursor adelante una palabra |
| `W` | Mover cursor adelante un WORD (bloque de no-whitespace) |
| `b` | Mover cursor atrás una palabra |
| `B` | Mover cursor atrás un WORD (bloque de no-whitespace) |
| `0` / `$` | Mover cursor al inicio de línea / fin de línea |
| `2w`, `3b`, ... | Prefijo de conteo repite el movimiento |

#### Cambios de modo

| Tecla | Acción |
|-----|--------|
| `a..z` (pista) | Colocar cursor en posición de texto indicada por pista |
| `v` | Entrar en modo Visual desde cursor actual |
| `Escape` | Salir al modo Normal |

---

### Modo visual

Entra en modo Visual con `v` desde el modo Normal. Si no hay selección de texto existente, el plugin muestra **insignias de pista** (etiquetas amarillas) en inicios de oración a través de la página visible. Presiona la letra correspondiente para anclar la selección en esa posición. La selección luego crece al presionar teclas de movimiento.

#### Movimiento de selección

| Tecla | Acción |
|-----|--------|
| `j` / `k` | Extender selección hacia abajo / arriba una línea |
| `h` / `l` | Extender selección hacia la izquierda / derecha un carácter |
| `w` / `b` | Extender selección hacia adelante / atrás una palabra |
| `0` / `$` | Extender selección al inicio / fin de línea |
| `)` / `(` | Extender selección al inicio de próxima / anterior oración |
| `}` / `{` | Extender selección al fin / inicio de párrafo |
| `o` | **Intercambiar ancla y foco** — saltar al opuesto extremo de la selección (como Vim's `o` en modo Visual); subsecuentes teclas de movimiento extienden desde el nuevo extremo |

#### Creación de anotaciones

| Tecla | Acción |
|-----|--------|
| `zy` | Crear un resaltado **amarillo** |
| `zr` | Crear un resaltado **rojo** |
| `zg` | Crear un resaltado **verde** |
| `zb` | Crear un resaltado **azul** |
| `zp` | Crear un resaltado **morado** |
| `za` | Añadir una anotación **nota** (crea resaltado + abre editor de comentario) |
| `i` | Igual que `za` (nota rápida + entrar en Insertar en comentario) |

#### Copiar texto

| Tecla | Acción |
|-----|--------|
| `y` | Copiar la **selección actual** al portapapeles |
| `yy` | Copiar el **párrafo completo** conteniendo la selección al portapapeles |
| `#` | Abrir la barra de búsqueda y buscar por la **selección actual** |

Todas las operaciones de copia aplican normalización NFKC (resuelve ligaduras como `ﬁ` → `fi`) y colapsan saltos de línea de separación de PDF en espacios.

#### Salir del modo Visual

| Tecla | Acción |
|-----|--------|
| `v` | Salir al modo Normal (limpia selección) |
| `Escape` | Salir al modo Normal (limpia selección) |

---

### Modo Insertar

En modo Insertar, todas las teclas son pasadas a Zotero sin cambios. Esto es útil cuando necesitas escribir en elementos de UI de Zotero sin que los atajos de vim intercepten tus pulsaciones.

Cuando `i` se presiona en modo Normal mientras una anotación está seleccionada (via `[`/`]`), el plugin automáticamente entra en modo Insertar **y** enfoca el campo de comentario de la anotación para que puedas empezar a escribir inmediatamente. Presiona `Escape` para guardar y volver al modo Normal.

| Tecla | Acción |
|-----|--------|
| `Escape` | Salir de modo Insertar → Normal |

---

## Flujo de trabajo de anotación

### Crear un resaltado desde cero

1. Presionar `v` para entrar en modo Visual.
2. Presionar la letra de pista mostrada en el inicio de oración deseado (o `j`/`k` para empezar desde la posición actual).
3. Extender la selección con `j`/`k`/`w`/`b`/`)`/`}`/`h`/`l`.
4. Usar `o` para saltar al otro extremo de la selección si necesitas recortar el inicio en lugar de extender el fin.
5. Presionar `zy`/`zr`/`zg`/`zb`/`zp` para crear un resaltado de color, o `za` para añadir una nota.

### Navegar y editar anotaciones existentes

1. Presionar `]` / `[` para mover a la siguiente / anterior anotación. La anotación se resalta en el visor de PDF y la barra lateral se desplaza a su tarjeta.
2. Presionar `y` para copiar el texto resaltado, `yy` para copiar el comentario.
3. Presionar `i` (o `Enter`) para abrir el campo de comentario y escribir una nota. Presionar `Escape` para volver al modo Normal.
4. Presionar `dd` para eliminar la anotación.

---

## Tareas pendientes

- [ ] Integración nativa de barra lateral del lector: integrar directamente con la barra lateral izquierda construida en Zotero/PDF.js. La superposición personalizada de explorador de esquema está disponible, pero el flujo de trabajo de barra lateral nativa aún está diferido porque su comportamiento de foco/DOM es menos estable.

---

## Personalización de atajos de teclado

Abrir **Editar → Preferencias** (macOS: **Zotero → Ajustes**) y navegar al pestaña **Zotero Vim**.

- Cada fila en la tabla **Atajos de teclado** mapea un *modo + secuencia de teclas* a una *acción*.
- Clic en la celda de secuencia de teclas para editarla directamente.
- Usar letras minúsculas. Prefijar con `ctrl+` para Ctrl (o Cmd en macOS).
- Secuencias multi-tecla como `gg`, `zy`, o `yy` son soportadas.
- Clic en **+ Añadir binding** para agregar una nueva fila; clic en **×** para remover una.
- Clic en **Aplicar bindings** para guardar cambios de atajos de teclado.
- Los ajustes de comportamiento de desplazar tienen un botón separado **Aplicar configuración**.
- Los colores de resaltado y los cambios de modo de activación se guardan automáticamente al cambiar.
- El modo Vim de editor de notas puede ser activado o desactivado independientemente desde el panel de preferencias.
- Clic en **Restablecer a predeterminados** para restaurar todos los bindings a sus valores predeterminados.

### Referencia de acciones

| Acción | Descripción |
|--------|-------------|
| `scrollDown` | Desplazar hacia abajo por el paso configurado |
| `scrollUp` | Desplazar hacia arriba por el paso configurado |
| `scrollLeft` | Desplazar hacia la izquierda por el paso configurado |
| `scrollRight` | Desplazar hacia la derecha por el paso configurado |
| `halfPageDown` | Desplazar hacia abajo media página |
| `halfPageUp` | Desplazar hacia arriba media página |
| `fullPageDown` | Desplazar hacia abajo página completa |
| `fullPageUp` | Desplazar hacia arriba página completa |
| `scrollTop` | Reposicionar vista para que página actual esté en topo |
| `scrollCenter` | Reposicionar vista para que página actual esté centrada |
| `scrollBottom` | Reposicionar vista para que página actual esté en fondo |
| `prevPage` | Página anterior |
| `nextPage` | Página siguiente |
| `firstPage` | Primera página |
| `lastPage` | Última página |
| `openSearch` | Abrir barra de búsqueda |
| `findNext` | Saltar al siguiente resultado de búsqueda |
| `findPrevious` | Saltar al resultado de búsqueda anterior |
| `clearSearch` | Cerrar / borrar barra de búsqueda |
| `prevAnnotation` | Saltar a anotación anterior |
| `nextAnnotation` | Saltar a anotación siguiente |
| `editAnnotation` | Enfocar campo de comentario de anotación (Enter) |
| `deleteAnnotation` | Eliminar anotación seleccionada |
| `filterYellow` | Filtrar barra lateral a anotaciones amarillas solamente |
| `filterRed` | Filtrar barra lateral a anotaciones rojas solamente |
| `filterGreen` | Filtrar barra lateral a anotaciones verdes solamente |
| `filterBlue` | Filtrar barra lateral a anotaciones azules solamente |
| `filterPurple` | Filtrar barra lateral a anotaciones moradas solamente |
| `filterClear` | Borrar filtro de color (mostrar todas las anotaciones) |
| `recolorYellow` | Cambiar color de anotación seleccionada a amarillo |
| `recolorRed` | Cambiar color de anotación seleccionada a rojo |
| `recolorGreen` | Cambiar color de anotación seleccionada a verde |
| `recolorBlue` | Cambiar color de anotación seleccionada a azul |
| `recolorPurple` | Cambiar color de anotación seleccionada a morado |
| `yankAnnotation` | Copiar texto resaltado de anotación |
| `yankAnnotationComment` | Copiar texto de comentario de anotación |
| `enterVisual` | Entrar en modo Visual |
| `enterCursor` | Entrar en modo Cursor |
| `enterInsert` | Entrar en modo Insertar (también enfoca comentario si anotación seleccionada) |
| `exitMode` | Volver al modo Normal |
| `extendDown` | Extender selección hacia abajo una línea |
| `extendUp` | Extender selección hacia arriba una línea |
| `extendLeft` | Extender selección hacia la izquierda un carácter |
| `extendRight` | Extender selección hacia la derecha un carácter |
| `extendWordForward` | Extender selección a palabra siguiente |
| `extendWordBackward` | Extender selección a palabra anterior |
| `extendLineStart` | Extender selección al inicio de línea actual |
| `extendLineEnd` | Extender selección al fin de línea actual |
| `extendSentenceForward` | Extender selección a inicio de próxima oración |
| `extendSentenceBackward` | Extender selección a inicio de oración anterior |
| `extendParagraphForward` | Extender selección al fin de párrafo actual |
| `extendParagraphBackward` | Extender selección al inicio de párrafo actual |
| `highlightYellow` | Crear resaltado amarillo |
| `highlightRed` | Crear resaltado rojo |
| `highlightGreen` | Crear resaltado verde |
| `highlightBlue` | Crear resaltado azul |
| `highlightPurple` | Crear resaltado morado |
| `addNote` | Añadir anotación nota |
| `copySelection` | Copiar selección actual al portapapeles |
| `searchSelection` | Abrir barra de búsqueda y buscar por selección actual |
| `yankParagraph` | Copiar párrafo completo al portapapeles |
| `swapVisualEnds` | Intercambiar ancla y foco de selección |
| `cursorDown` | Mover cursor hacia abajo una línea visual (modo Cursor) |
| `cursorUp` | Mover cursor hacia arriba una línea visual (modo Cursor) |
| `cursorLeft` | Mover cursor hacia la izquierda un carácter (modo Cursor) |
| `cursorRight` | Mover cursor hacia la derecha un carácter (modo Cursor) |
| `cursorWordForward` | Mover cursor adelante una palabra (modo Cursor) |
| `cursorBigWordForward` | Mover cursor adelante un WORD (modo Cursor) |
| `cursorWordBackward` | Mover cursor atrás una palabra (modo Cursor) |
| `cursorBigWordBackward` | Mover cursor atrás un WORD (modo Cursor) |
| `cursorLineStart` | Mover cursor al inicio de línea (modo Cursor) |
| `cursorLineEnd` | Mover cursor al fin de línea (modo Cursor) |
| `cursorToVisual` | Entrar en modo Visual desde cursor actual |
| `mainTabPick` | Abrir selector de pestañas para pestañas Zotero abiertas actualmente |
| `mainNotesLayout` | Alternar superposición de diseño de notas (lista izquierda + vista previa derecha) |
| `mainFuzzyAll` | Abrir selector difuso sobre todos los elementos de la biblioteca actual |
| `mainFuzzyCollection` | Abrir selector difuso sobre los elementos de la colección actual |
| `mainYankCitekey` | Copiar la citekey del elemento seleccionado al portapapeles |
| `mainOpenPDF` | Abrir el PDF del elemento seleccionado |
| `mainClosePDF` | Cerrar la pestaña de PDF activa |
| `mainPrevTab` | Cambiar a la pestaña abierta anterior |
| `mainNextTab` | Cambiar a la siguiente pestaña abierta |
| `mainFocusTree` | Enfocar el árbol de colecciones (panel izquierdo) |
| `mainFocusItems` | Enfocar la lista de elementos (panel central) |
| `mainFocusLeft` | Enfocar el árbol de colecciones (panel izquierdo) |
| `mainFocusRight` | Enfocar el panel de detalles (panel derecho) |
| `mainFocusSearch` | Enfocar la barra de búsqueda de Zotero |
| `mainNavDown` | Mover la selección hacia abajo (árbol de colecciones / lista de elementos) |
| `mainNavUp` | Mover la selección hacia arriba (árbol de colecciones / lista de elementos) |
| `mainNavFirst` | Saltar a la primera fila |
| `mainNavLast` | Saltar a la última fila |
| `toggleReaderSidebarOutline` | Alternar la superposición personalizada de explorador de esquema |
| `focusReaderSidebar` | Enfocar o reabrir la superposición personalizada de explorador de esquema |
| `toggleReaderSplitHorizontal` | Alternar vista dividida horizontal del lector |
| `toggleReaderSplitVertical` | Alternar vista dividida vertical del lector |
| `focusReaderSplitLeft` | Enfocar panel dividido izquierdo (o alternar en división horizontal) |
| `focusReaderSplitDown` | Enfocar panel dividido inferior (o alternar en división vertical) |
| `focusReaderSplitUp` | Enfocar panel dividido superior (o alternar en división vertical) |
| `focusReaderSplitRight` | Enfocar panel dividido derecho (o alternar en división horizontal) |
| `mainActivate` | En colecciones, entrar en lista de elementos; en elementos, abrir elemento/PDF seleccionado |
| `mainTreeToggle` | Alternar expandir/colapsar para colección seleccionada |
| `mainTreeOpenOnly` | Expandir colección seleccionada sin cambiar panel |
| `mainTreeCloseOnly` | Colapsar colección seleccionada sin moverse a padre |
| `mainTreeExpand` | Expandir colección seleccionada o mover foco al interior de la lista de elementos |
| `mainTreeCollapse` | Colapsar colección seleccionada, moverse a padre, o volver foco al árbol de colecciones |
| `mainTreeParent` | Mover selección a colección padre |
| `mainTreeExpandAll` | Expandir todas las colecciones en árbol de biblioteca izquierdo |
| `mainTreeCollapseAll` | Colapsar todas las colecciones en árbol de biblioteca izquierdo |

---

## Configuración

| Ajuste | Predeterminado | Descripción |
|---------|---------|-------------|
| Habilitar modo Visual | activado | Permitir entrar en modo Visual con `v` |
| Habilitar modo Cursor | activado | Permitir entrar en modo Cursor con `c` |
| Habilitar modo Insertar | activado | Permitir entrar en modo Insertar con `i` |
| Modo Vim de editor de notas | activado | Habilitar edición estilo Vim en editores de notas (panel de contexto y pestañas de notas) |
| Paso de desplazar | 60 px | Píxeles desplazados por pulsación de `j`/`k`/`H`/`L` |
| Desplazamiento suave | activado | Habilitar comportamiento de desplazamiento suave en lector |
| Velocidad inicial suave | 2000 px/s | Velocidad inicial para desplazamiento basado en mantenimiento de tecla |
| Velocidad máxima suave | 2000 px/s | Velocidad máxima de desplazamiento suave |
| Aceleración suave | 2600 px/s² | Incremento de velocidad mientras tecla se mantiene presionada |
| Deceleración suave | 4200 px/s² | Disminución de velocidad después de tecla es liberada |
| Detener al soltar | desactivado | Si habilitado, detener inmediatamente al tecla es liberada |
| Color de resaltado predeterminado | Amarillo | Color usado cuando no hay tecla de color explícita presionada |

Los ajustes de desplazamiento son almacenados temporalmente y solo se guardan cuando haces clic en **Aplicar configuración**.

Por defecto, `velocidad inicial` y `velocidad máxima` son ambas `2000`, lo que da una sensación más constante "sin salto de aceleración" que muchos usuarios perciben como más suave. Si prefieres dinámicas de aceleración/deceleración más fuertes, puedes setear valores diferentes para estos parámetros.

---

## Notas sobre la arquitectura

Estas notas están destinadas a contribuidores o cualquiera depurando el plugin.

### Pila de iframe de tres niveles

El lector de PDF de Zotero es renderizado dentro de iframes anidados:

```
Ventana chrome de Zotero
  └─ reader.html          (reader._iframeWindow)
       └─ iframe de PDF.js   (reader._internalReader._primaryView._iframeWindow)
```

Eventos de teclado son capturados en el nivel más interno (PDF.js) usando un
listener `keydown` registrado con `capture: true` en `pdfWin.addEventListener`.

### Seguridad de compuerta cruzada

`reader._internalReader` y los objetos del visor de PDF.js viven en diferentes
compartimentos de seguridad del contexto chrome de Zotero. Cualquier objeto o arreglo
pasado como argumento a través de esta frontera debe ser clonado primero:

```js
Components.utils.cloneInto(value, targetWindow)
```

Valores primitivos (números, cadenas, booleanos) cruzan compartimentos libremente.
Olvidar `cloneInto` produce errores `"Permission denied to access property"` que
son fáciles de ignorar porque son a menudo capturados y silenciosamente swalloweados.

### Conflictos de atajos incorporados de Zotero (lectura en voz alta)

La aplicación React del lector de Zotero inicia la lectura en voz alta con las
teclas `l`/`r` y alterna la herramienta de mano / puntero con `h`/`s` desde su
`KeyboardManager`. Las teclas presionadas dentro del iframe de PDF.js llegan a
él mediante una **llamada JS directa** — `view._onKeyDown(event)` en el
`pdf-view.js` del lector — no mediante propagación de eventos DOM. Eso
significa:

- `preventDefault()` / `stopPropagation()` dentro del iframe de PDF.js no
  pueden detenerla: el listener de captura de Zotero corre en la *misma*
  ventana que el del plugin, y el reenvío es una llamada de función, no un
  despacho de evento.
- Los eventos keydown nativos nunca cruzan la frontera del iframe hacia
  reader.html, así que los interceptores a nivel de documento allí nunca ven
  las teclas del PDF.

El plugin por lo tanto parchea el propio callback de reenvío:

- `_patchReaderKeyForwarding()` reemplaza `_onKeyDown` en las instancias de
  PdfView (`_internalReader._primaryView` / `_secondaryView`) con un envoltorio
  que descarta el evento cuando `_readerConsumesKey()` dice que vim lo manejará
  (enlace exacto o prefijo para el modo actual). El modo Insertar lo pasa todo
  excepto Escape.
- El envoltorio cruza la frontera chrome/contenido mediante `Cu.unwrap` +
  `Cu.exportFunction` (una función chrome pura sería rechazada por el
  compartimento de contenido).
- `_onKeyDown` además usa `stopImmediatePropagation()` (no `stopPropagation()`)
  donde vim consume una tecla, así el listener de captura de la misma ventana
  de Zotero se omite cuando el listener del plugin se registró primero.

El parche se reaplica por el temporizador de sincronización de vista de 800 ms
(sobrevive a recreación de vista, vistas divididas y sesiones restauradas). Si
Zotero cambia los internos de reenvío del lector, verifica de nuevo
`view._onKeyDown` y la tabla de atajos de `KeyboardManager`.

### Navegación de anotaciones

`reader._internalReader.setSelectedAnnotations(Cu.cloneInto([key], readerWin))`
es la única llamada que maneja todo — desplaza el PDF a la anotación, muestra el
resaltado de selección, y desplaza la tarjeta de la barra lateral a vista. No
llamar también `currentPageNumber = N` o `scrollPageIntoView`; esas compiten con
la navegación interna y causan saltos de página jarringos.

### Selección de texto en modo Visual

PDF.js renderiza cada línea visual como un `<span>` posicionado absolutamente en un
elemento `.textLayer` (un `.textLayer` por página). APIs del navegador como
`Selection.modify('extend', 'line')` son poco confiables en este contexto.

El plugin implementa su propia extensión de línea (`_extendByLine`) usando
`document.caretPositionFromPoint` y un escaneo de fallback de geometría de span.
Extensiones de oración y párrafo (`_extendBySentence`, `_extendByParagraph`) escanean
todos los elementos `.textLayer span` de *todas las páginas* usando
`document.querySelectorAll('.textLayer span')` — **no**
`document.querySelector('.textLayer')` que retorna solo la primera página.

Selecciones son rastreadas con `state.visualCursor = { textNode, offset }` como el
ancla para que `sel.addRange()` pueda reconstruir el rango correcto después de que
PDF.js ocasionalmente limpia la selección del navegador.

### Postprocesamiento de texto (operaciones yank)

Todas las operaciones de portapapeles pasan el `sel.toString()` o `annotationText`
crudo a través de:

1. `text.normalize('NFKC')` — descompone ligaduras Unicode (`ﬁ` → `fi`, etc.)
2. `text.replace(/\n/g, ' ')` — colapsa saltos de línea de separación de PDF en espacios
3. `text.replace(/ {2,}/g, ' ').trim()` — normaliza whitespace

### Campo de comentario de anotación

El campo de comentario de la anotación es un div `contenteditable` con
`aria-label="Annotation comment"` dentro de una tarjeta de barra lateral identificada por
`[data-sidebar-annotation-id="${key}"]`. Es enfocado con `.focus()` solo —
llamar `.click()` desde el contexto chrome crea un `MouseEvent` privilegiado
que el código de contenido no puede leer, causando un error de wrapper de seguridad.
