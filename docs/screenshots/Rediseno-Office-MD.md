# Rediseño Office-like para ModernRefine (Inspirado en DashCraft)

**Meta:** Rediseñar la UI principal actual de **ModernRefine** (`modern-refine/`) para adoptar el estilo **Office-like / Fluent 2 Light** de **DashCraft**, incluyendo sus decisiones de color, jerarquía visual, tipografía, densidad de datos y estructura de paneles.
**Alcance estricto:** Se trabaja **únicamente sobre `modern-refine/`** en su UI más reciente (`src/App.tsx`, `src/App.css`). **NO** se trabaja sobre Analyticraft, **NO** se agregan DuckDB-WASM ni ECharts, y **NO** se modifica la lógica ETL de `src/lib/refineEngine.ts`, `src/types/refine.ts` ni el backend Tauri/Rust.

> **Estado actual:** Documento de especificación adaptado. Aún no se modifica código; sirve como guía directa para rediseñar `modern-refine/src/`.

---

## 1. Decisión técnica — CSS Tokens propios sobre el stack actual

`modern-refine` ya cuenta con **React 19 + TypeScript + Vite 8 + Tauri v2 + Lucide React + SheetJS (`xlsx`)** y un sistema de estilos en `src/App.css` basado en variables CSS (`--mr-*`).

| Aspecto | Decisión | Por qué |
| :--- | :--- | :--- |
| **Estilos** | **CSS Tokens (`src/styles/tokens.css`) + `src/App.css` refactorizado** | Cero dependencias nuevas. Control total del look DashCraft/Office sin pelear con temas oscuros o librerías pesadas. |
| **Iconos** | **Mantener `lucide-react`** con wrapper `Icon.tsx` (`size={16\|20}`, `strokeWidth={1.75}`) | Coherencia de trazo en Ribbon, ViewRail, Inspector y StatusBar sin rehacer SVGs. |
| **Lógica ETL** | **Intocable (`refineEngine.ts`)** | Toda la transformación de columnas, clustering, facetas, undo/redo, papelera y exportación CSV/XLSX se conserva intacta; solo cambia la capa visual y su distribución en el shell. |

---

## 2. Filosofía y decisiones estéticas (DashCraft Office-Like)

### SÍ se adopta de DashCraft
1. **Modo claro Office / Fluent 2 Light:** Chrome neutro gris (`#f5f5f5`), superficies de trabajo y paneles en blanco puro (`#ffffff`), bordes nítidos de `1px` (`#e0e0e0`). Se reemplaza por completo el tema oscuro actual tipo VS Code.
2. **Paleta de marca DashCraft (Teal `#117865` + acentos funcionales):**
   - **Teal `#117865`** como color primario de identidad: pestaña activa del Ribbon (subrayado inferior), barra vertical del ViewRail activo, **encabezado de la columna seleccionada en el grid**, badges/pills numéricos de conteo y botón primario (`Aplicar`, `Exportar`).
   - **Azul de selección de celda (`#0066cc` / `#0078d4`)** para la celda activa/enfocada dentro del grid, diferenciando claramente foco de celda vs. columna seleccionada.
   - **Amarillo/Ámbar (`#f2c811`)** reservado únicamente para detalles sutiles de marca/icono o advertencias de calidad de datos junto a semánticos estándar.
3. **Comandos visibles aunque estén deshabilitados:** Si no hay archivo cargado o columna seleccionada, los botones del Ribbon permanecen visibles en estado deshabilitado (`opacity: 0.42`), nunca ocultos. El usuario aprende dónde vive cada herramienta.
4. **Radios pequeños y geometría sobria:** `border-radius: 4px` (o `2px` en controles compactos). Nada de pills exageradas (`999px`) en botones o pestañas del chrome (solo en contadores numéricos compactos tipo badge como `34`, `5`, `8`).
5. **Densidad tabular limpia:** Números alineados a la derecha con `font-variant-numeric: tabular-nums` en el grid, inspector de columna y barra de estado.

### NO se trae de Analyticraft ni de Power BI
- **NO** canvas libre de reportes, **NO** ECharts, **NO** vistas de Modelo relacional / DAX / TMDL.
- Las vistas y controles responden 100% al flujo real de **ModernRefine (Estación ETL Pre-BI)**: carga de CSV/Excel, limpieza rápida, normalización de fechas, clustering de variantes, facetas de filtrado, historial de pasos, papelera reversible y receta JSON.

---

## 3. Tokens de diseño (`--mr-*`) — Paleta DashCraft Light

> Prohibido usar colores hexadecimales sueltos en componentes o reglas nuevas; todo pasa por variables CSS en `:root`.

```css
:root {
  color-scheme: light;

  /* Chrome y superficies */
  --mr-chrome: #f5f5f5;         /* TitleBar, RibbonTabs, ViewRail, StatusBar */
  --mr-chrome-hover: #ebebeb;
  --mr-surface: #ffffff;        /* Cuerpo del Ribbon, Grid, Panes, Diálogos */
  --mr-surface-subtle: #f8f9fa; /* Cabecera # de filas, zebra/hover suave */
  --mr-canvas: #eaeaea;         /* Fondo estructural detrás de paneles */
  --mr-col-selected-bg: #f0f2f2;/* Fondo sutil de celdas en la columna seleccionada */

  /* Bordes */
  --mr-border: #e0e0e0;
  --mr-border-grid: #e5e5e5;
  --mr-border-strong: #c8c8c8;

  /* Texto */
  --mr-text: #1f1f1f;
  --mr-text-secondary: #424242;
  --mr-text-muted: #616161;
  --mr-text-disabled: #a3a3a3;

  /* Acento DashCraft Teal */
  --mr-accent: #117865;         /* Header columna activa, tab activo, badges, primario */
  --mr-accent-hover: #0e6353;
  --mr-accent-soft: #e6f2ef;
  --mr-accent-text: #ffffff;

  /* Selección de celda y marca secundaria */
  --mr-cell-focus: #0066cc;
  --mr-brand-gold: #f2c811;

  /* Estados semánticos */
  --mr-ok: #107c10;
  --mr-ok-soft: #dff6dd;
  --mr-warn: #ca5010;
  --mr-warn-soft: #fff4ce;
  --mr-danger: #d13438;
  --mr-danger-soft: #fde7e9;

  /* Tipografía */
  --mr-font-ui: 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  --mr-font-mono: 'Cascadia Code', 'Cascadia Mono', Consolas, 'SF Mono', monospace;

  /* Medidas del shell */
  --mr-titlebar-h: 34px;
  --mr-ribbontabs-h: 30px;
  --mr-ribbonbody-h: 72px;
  --mr-rail-w: 48px;
  --mr-statusbar-h: 24px;
  --mr-inspector-w: 256px;
  --mr-pane-w: 272px;
  --mr-radius: 4px;
  --mr-shadow-menu: 0 4px 16px rgba(0, 0, 0, 0.12);
}
```

---

## 4. Tipografía

| Uso | Fuente | Tamaño / Peso |
| :--- | :--- | :--- |
| Título de ventana / archivo | `var(--mr-font-ui)` | `12px` / `500` |
| Tabs del Ribbon | `var(--mr-font-ui)` | `13px` / `400` (`600` en tab activo) |
| Etiqueta de botón en Ribbon | `var(--mr-font-ui)` | `11.5px` / `400`, centrado, máx. 2 líneas |
| Título de grupo del Ribbon | `var(--mr-font-ui)` | `11px` / `400`, color `--mr-text-muted`, abajo del grupo |
| Celdas y cabeceras del Grid | `var(--mr-font-ui)` | `12.5px` / `400` (`600` en headers), `tabular-nums` |
| Inspector y Panel derecho | `var(--mr-font-ui)` | `12.5px` / `400`, títulos de sección `14px` / `600` |
| Receta JSON / Valores técnicos | `var(--mr-font-mono)` | `12px` / `400` |

### 4.1 Iconografía híbrida (Lucide + Fluent UI System Icons)

Para lograr coherencia visual Office-like sin complicarse con múltiples librerías:

1. **Lucide React como base (~90% de los iconos):** Se mantiene `lucide-react` mediante un wrapper `Icon.tsx` (`size={16 | 20}`, `strokeWidth={1.75}`, `color="currentColor"`).
2. **Fluent UI System Icons para piezas clave del shell (~10–15 iconos):** Solo donde Lucide no tiene un equivalente Office claro (por ejemplo: vista `Datos/Tabla`, `Clustering`, `Receta/Pipeline`, `Papelera`, `Columna`, `Panel colapsable`, `Exportar libro`).
   - Se guardan en `src/assets/icons/` como `.svg` o componentes React ligeros, normalizados al mismo `viewBox` (`20x20` / `24x24`) y `currentColor` para que convivan sin saltos visuales con Lucide.
   - Se incluye la atribución correspondiente en `THIRD_PARTY_NOTICES.md`:

```text
Iconos Fluent UI System Icons — MIT License
Copyright (c) Microsoft Corporation
```
---

## 5. Arquitectura del Layout — Mapeo de `App.tsx` al estilo DashCraft

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ TitleBar (34px, #f5f5f5): [Logo][Abrir][Deshacer][Rehacer]  archivo - MR  [🔍 Buscar...] │
├──────────────────────────────────────────────────────────────────────────────┤
│ RibbonTabs (30px, #f5f5f5): Archivo | Inicio | Limpieza | Columna | Vista | Ayuda        │
├──────────────────────────────────────────────────────────────────────────────┤
│ RibbonBody (72px, #ffffff): [Grupo: Archivo] | [Grupo: Edición] | [Grupo: Limpiar] | ... │
├──────┬───────────────────────────────────────────┬──────────────┬────────────┤
│ Rail │ FilterBar: [≡][🔍 Filtrar filas...] [Aplicar] (i) N filas │              │
│ 48px ├───────────────────────────────────────────┤ Inspector    │ Pane       │
│      │ # | col_a ⌄ | col_b ⌄ | [col_sel ⌄ (Teal)]│ Columna      │ Derecho    │
│ [Grid│ 1 | ...     | ...     |  1750             │ 256px        │ 272px      │
│  📊  │ 2 | ...     | ...     |  [2300] (focus)   │              │            │
│  🧩  │ ...                                       │ Tipo / Stats │ Sesiones / │
│  📜  │                                           │ Min/Max/Vacío│ Pasos /    │
│  🗑  ├───────────────────────────────────────────┤ Acciones     │ Facetas    │
│      │ SheetTabs: [ventas.csv (3)] [clientes (0)]│              │            │
├──────┴───────────────────────────────────────────┴──────────────┴────────────┤
│ StatusBar (24px, #f5f5f5): Tabla: ventas (34 filas) | Col: costo | ● Datos cargados v0.1 │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 5.1 TitleBar + Quick Access Toolbar (`34px`, `--mr-chrome`)
- **Izquierda (Quick Access):** Icono de ModernRefine (`/mR_harmonia_cutout.png`, 18px) + botones compactos de acceso rápido: `Abrir archivo`, `Deshacer`, `Rehacer`, `Exportar`.
- **Centro:** Nombre de la sesión activa (`<archivo> - ModernRefine`) + caja de búsqueda global (`🔍 Buscar columna, valor o acción...`, fondo blanco, borde `1px solid var(--mr-border)`, radio `4px`).
- **Derecha:** Selector compacto de plantilla / formato de fecha si aplica, o limpio como en DashCraft.

### 5.2 Ribbon (`RibbonTabs` 30px + `RibbonBody` 72px) — Traspaso y unificación de botones
Los botones y menús actuales de `.mr-topbar`, `.mr-table-bar`, `.mr-quick-ops` y `.mr-col-dropdown-panel` **se traspasan y unifican** en el Ribbon (sin duplicar botoneras sueltas ni mezclar dos estilos visuales). Los controles nuevos del shell (toggles de paneles, vista, búsqueda) usan exactamente el mismo componente `RibbonButton`:
- **Tabs:**
  - `Archivo`: Abrir CSV/Excel (`Ctrl+O`), Plantillas de prueba, Cargar/Guardar Receta JSON (`Ctrl+Shift+O` / `Ctrl+S`), Exportar CSV / XLSX, Cerrar pestaña (`Alt+W`).
  - `Inicio`: Deshacer (`Ctrl+Z`), Rehacer (`Ctrl+Y`), Formato de fecha global, Exportar rápido.
  - `Limpieza`: Recortar espacios, Normalizar espacios internos, Quitar caracteres no imprimibles, Rellenar vacías, Eliminar duplicados (`Alt+2`), Eliminar filas vacías.
  - `Texto y Fechas`: Mayúsculas (`Alt+U`), Minúsculas, Título, Normalizar fechas ISO (`Alt+I`), Dividir/Reemplazar.
  - `Columna` *(tab contextual destacado cuando hay columna seleccionada)*: Renombrar (`Alt+R`), Duplicar (`Alt+D`), Mover, Eliminar a Papelera (`Alt+X`), Deduplicar / Clustering.
  - `Vista`: Mostrar/ocultar Inspector de Columna, Panel Derecho, Panel Izquierdo (si aplica) y Líneas de cuadrícula.
  - `Ayuda`: Guía rápida, Mapa de atajos de teclado (`?`), Acerca de ModernRefine.
- **Estilo de botón (`RibbonButton`):** Icono arriba (`20px`) + etiqueta abajo (`11.5px`), hover `#ebebeb`, separadores verticales entre grupos y nombre del grupo centrado abajo en `--mr-text-muted`. Todos los botones muestran su atajo en el `tooltip` (`title`).

### 5.3 Left ViewRail (`48px`, `--mr-chrome`)
Barra vertical fija a la izquierda para cambiar el modo de trabajo sin perder las sesiones abiertas:
1. **Datos (Grid):** Vista principal (Tabla + Inspector de Columna + Panel Derecho). Activa por defecto con barra vertical de `3px` en `#117865` y fondo blanco.
2. **Clustering:** Vista enfocada para revisar grupos de variantes similares (`mr-cluster-card`) con más espacio horizontal.
3. **Receta (JSON):** Visor limpio de la receta ETL reproducible (`recipeJson`) con botón copiar/exportar.
4. **Papelera:** Vista/gestión de columnas y filas eliminadas recuperables.

*(Nota: Las vistas secundarias también pueden seguir accesibles desde pestañas del panel derecho si el usuario prefiere no salir del Grid).*

### 5.4 Filter / Formula Bar (encima del Grid, fondo `#ffffff`)
Inspirada directamente en la barra `SQL filter` de DashCraft:
- Icono de filtro + input blanco limpio (`Filtrar filas o buscar en la tabla...`) + botón `Aplicar` (y botón `Limpiar` cuando hay filtro activo).
- A la derecha: icono `(i)` con tooltip de sintaxis/ayuda + contador tabular (`34 filas` o `12 de 34 filas`).

### 5.5 Data Grid Central (`table.mr-table`)
- Fondo blanco `#ffffff`, líneas de cuadrícula `1px solid var(--mr-border-grid)`.
- Columna `#` de número de fila en gris sutil (`--mr-surface-subtle`), texto centrado/derecha en `--mr-text-muted`.
- Cabeceras de columna con nombre a la izquierda y botón/chevron de menú (`⌄`) a la derecha (abre el menú contextual de columna existente).
- **Columna seleccionada:**
  - Cabecera con fondo sólido **`#117865` (Teal)**, texto blanco en negrita y chevron blanco.
  - Celdas de esa columna con tinte sutil `--mr-col-selected-bg`.
- **Celda en edición / foco:** Borde nítido de `2px` en `--mr-cell-focus` (`#0066cc`) o selección azul sólido al estilo hoja de cálculo.
- **Pestañas de sesiones abiertas (`SheetTabs`):** En la parte inferior (estilo Excel) o superior del grid, con fondo blanco para la pestaña activa, borde superior/inferior en `#117865` y badge numérico con la cantidad de pasos aplicados.

### 5.6 Paneles colapsables estilo Power BI (Inspector de Columna + Panel Derecho)
Tanto el **Inspector de Columna** (`256px`) como el **Panel Derecho** (`272px`) —y cualquier panel lateral izquierdo auxiliar si se habilita en vistas secundarias— son **colapsables al estilo Power BI / DashCraft**:
- **Estado expandido:** Fondo blanco `--mr-surface`, borde lateral `1px solid var(--mr-border)`, botón de colapsar (`»` / `«` o `×`) en la esquina superior derecha del header.
- **Estado colapsado:** El panel se pliega a una **tira vertical delgada de `28px`** en `--mr-chrome` (`#f5f5f5`) con el icono chevron de expandir arriba y el título del panel rotado verticalmente (`writing-mode: vertical-rl`), permitiendo reabrirlo con un solo clic (o mediante atajo de teclado / `Ribbon > Vista`). El Grid central absorbe automáticamente todo el ancho liberado.

#### Inspector de Columna (`256px`, equivalente a `costo_unitario` en DashCraft)
- **Header:** Icono de tipo de dato + nombre de la columna seleccionada + botón colapsar (`×` / `»`).
- **Metadatos:** `Tipo` (Texto / Número / Fecha inferido), `Formato`.
- **Tabla de diagnóstico (alineada izquierda/derecha con `tabular-nums`):** `Filas`, `Válidas`, `Vacías` (con % y `--mr-danger` si > 0), `Únicas / Variantes`, `Espacios extra`, `Mayús-Minús mixto`.
- **Acciones rápidas de columna:** Acceso directo a limpiar o filtrar esa columna.

#### Panel Derecho (`272px`, equivalente a `Data` en DashCraft)
- **Header:** Título (`Datos y Pasos`) + botón `»` para colapsar.
- **Buscador interno** (`🔍 Buscar...`) + menú `...`.
- **Pestañas limpias:** `Sesiones | Pasos | Facetas`:
  - **Sesiones / Tablas:** Lista de archivos cargados con badge circular teal (ej. `34` filas) y conteo de pasos.
  - **Pasos (Historial):** Acordeón de pasos agrupados (`.mr-acc-group`) con checkbox para activar/desactivar o eliminar pasos, en blanco con bordes `#e0e0e0`.
  - **Facetas:** Lista de valores únicos con conteo tabular a la derecha y acciones rápidas de reemplazo/filtrado.

### 5.7 StatusBar (`24px`, `--mr-chrome`, borde superior `1px solid var(--mr-border)`)
- **Izquierda:** `Tabla: <nombre> (<N> filas) | Columna: <nombre> (<K> valores únicos) | <M> pasos aplicados`
- **Derecha:** Indicador `● Datos cargados` (punto en `#117865` / `#107c10`), contadores de advertencias/vacías, y versión `ModernRefine 0.1.0`.

---

## 6. Política Keyboard-First (Atajos de teclado obligatorios)

Se mantiene estrictamente la política de que **toda la interfaz, comandos actuales y próximas acciones relevantes** puedan operarse sin soltar el teclado:

1. **Preservación total de atajos actuales (`onGlobalKeyDown` y `handleTableKeyDown` en `App.tsx`):**
   - Archivos y recetas: `Ctrl+O` (abrir), `Ctrl+Shift+O` (cargar receta), `Ctrl+S` (guardar receta), `Alt+W` (cerrar pestaña), `Alt+N` (nueva plantilla/sesión).
   - Edición e historial: `Ctrl+Z` (deshacer), `Ctrl+Y` (rehacer).
   - Operaciones de columna: `Alt+D` (duplicar), `Alt+R` (renombrar), `Alt+X` (eliminar a papelera), `Alt+2` (duplicados), `Alt+I` (normalizar fechas ISO), `Alt+U` (mayúsculas).
   - Navegación y edición inline en Grid: flechas, `Enter`/`F2` para editar celda, `Esc` para cancelar.
2. **Atajos para los nuevos controles del shell DashCraft/Office:**
   - `Ctrl+K`: enfocar barra de búsqueda global del TitleBar (paleta de comandos / columnas).
   - `Ctrl+F`: enfocar barra de filtro (`FilterBar`) sobre el Grid.
   - `Ctrl+1..4`: cambiar vista en el `ViewRail` (`Datos`, `Clustering`, `Receta`, `Papelera`).
   - `Ctrl+Alt+I` / `Ctrl+Alt+P`: colapsar/expandir `Inspector de Columna` y `Panel Derecho`.
   - Navegación por `Tab` / flechas entre pestañas del Ribbon y foco visible (`outline: 2px solid var(--mr-accent)`).
3. **Regla para futuras funcionalidades:** Ningún botón o acción nueva se aprueba en el Ribbon o en paneles sin su atajo registrado en `onGlobalKeyDown` y documentado en su `title` y en `Ayuda > Atajos de teclado`.

---

## 7. Fases sugeridas de implementación (cuando se apruebe tocar código)

1. **Fase 1 — Tokens y Base Light (`src/styles/tokens.css` + `src/App.css`):** Migrar `:root` de dark mode a los tokens Office/DashCraft Light y actualizar scrollbars a estilo neutro claro (`#f5f5f5` track / `#c8c8c8` thumb).
2. **Fase 2 — Shell Chrome (`TitleBar`, `Ribbon`, `ViewRail`, `StatusBar`):** Reestructurar el header actual (`.mr-topbar`) en TitleBar + Ribbon de 2 filas y añadir el ViewRail izquierdo y la StatusBar inferior.
3. **Fase 3 — Grid + FilterBar:** Aplicar estilo DashCraft al grid (columna `#`, cabecera activa en `#117865`, celda enfocada `#0066cc`, barra de filtro superior con botón `Aplicar`).
4. **Fase 4 — Column Inspector + Right Pane:** Separar el diagnóstico de columna en el panel inspector estilo `costo_unitario` y estilizar el panel derecho (`Pasos`, `Facetas`, `Sesiones`) en blanco con badges teal.
5. **Fase 5 — Verificación visual y build:** Comprobar `npm run build` (`tsc && vite build`) y probar flujos completos de carga CSV/Excel, edición inline, undo/redo, clustering y exportación.

---

## 8. Checklist de no-regresión

- [ ] No modificar la lógica de transformación en `src/lib/refineEngine.ts` ni los tipos en `src/types/refine.ts`.
- [ ] No introducir dependencias de Analyticraft (DuckDB, ECharts, Canvas de reportes).
- [ ] No dejar colores dark-mode residuales (`#1e1e1e`, `#252526`, `#007acc` como acento global) en `App.css`.
- [ ] Mantener todos los botones del Ribbon visibles aunque estén deshabilitados cuando no haya datos cargados.
- [ ] Verificar que la app siga compilando limpia con `tsc && vite build` y en Tauri (`tauri dev`).
