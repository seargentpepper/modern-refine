<p align="center">
  <img src="mR_harmonia_cutout.png" width="128" height="128" alt="ModernRefine icon">
</p>

<h1 align="center">ModernRefine</h1>

**Estación de limpieza y preparación de datos (*Pre-BI Cleaning Station*) *local-first* y nativa: reimplementación moderna de OpenRefine en Tauri v2, Rust, DuckDB nativo (sin WASM) y React, diseñada como antesala independiente dentro del ecosistema [Analyticraft](https://seargentpepper.github.io/Analyticraft/).**

<p align="center">
  Transforma datos crudos (<code>.csv</code>, <code>.tsv</code>, <code>.xlsx</code>, <code>.ods</code>, <code>.json</code>, Web/REST, tablas de Wikipedia y snapshots SQL) en tablas limpias, tipadas y exportables a <strong>Excel</strong>, <strong>CSV</strong> o <strong>Apache Parquet</strong> en minutos, sin código, con historial 100% reversible y recetas automatizables (<code>.refine.json</code>).
</p>

<p align="center">
  <img alt="Versión: 0.5.1" src="https://img.shields.io/badge/versión-0.5.1%20(Fluent%202%20Light)-0f766e?style=flat-square">
  <img alt="Tauri v2 + Rust" src="https://img.shields.io/badge/Tauri%20v2%20%2B%20Rust-Native%20Desktop-orange?style=flat-square">
  <img alt="DuckDB Nativo (Sin WASM)" src="https://img.shields.io/badge/DuckDB%20Nativo-C%2B%2B%20FFI%20(Sin%20WASM)-fff100?style=flat-square&labelColor=1e1e1e">
  <img alt="React 19 + TS 6 + Vite 8" src="https://img.shields.io/badge/React%2019%20%2B%20TS%206%20%2B%20Vite%208-UI-blue?style=flat-square">
</p>

---

## 1. Propósito y Lugar en el Ecosistema Analyticraft

Quien limpia datos todos los días en **Excel** o en el **OpenRefine clásico** choca rápido con tres problemas:
1. **Excel se congela y muta datos en silencio:** borra ceros iniciales en códigos postales (`08600` → `8600`), corrompe fechas regionales (`DD/MM` vs `MM/DD`) y aplica `Buscar y Reemplazar` destructivos sin auditoría.
2. **OpenRefine clásico arrastra un servidor Java + UI web heredada** y no ofrece SQL columnar nativo ni exportación moderna a Parquet.
3. **Analyticraft necesita recibir tablas confiables**, no archivos rotos de origen.

**ModernRefine** resuelve el tramo **Pre-BI (de crudo a pulido)**:
- **Todo paso es reversible y auditable:** cada limpieza se registra en un historial lineal agrupado en acordeones por columna/tarea; puedes apagar, encender o eliminar pasos intermedios, usar **Deshacer/Rehacer** desde el panel derecho (`Ctrl+Z` / `Ctrl+Y`) y recuperar filas o columnas ocultadas desde la **Papelera**.
- **Recetas reproducibles (`modern-refine/v1`):** limpia un reporte semanal una sola vez, exporta su archivo `.refine.json` (sin credenciales sensibles) y reaplica exactamente la misma cadena la próxima semana.
- **Arquitectura Nativa sin WASM:** el escritorio corre con **Rust (`modern_refine_engine`)** y **DuckDB nativo (`duckdb = "1.20000.2"`)** enlazado por FFI (`duckdb.dll` en Windows), evitando límites de memoria, arranque pesado o dependencias de WebAssembly.

---

## 2. Flujo de Trabajo (*Workflow* End-to-End)

El ciclo de trabajo dentro de ModernRefine sigue cinco etapas claras y no destructivas:

```text
  [1. Ingesta / Origen]          [2. Perfilado y Facetas]       [3. Limpieza y Fórmulas]
  • Archivos locales             • Barra de Calidad             • Clustering 5 niveles
    (CSV, TSV, XLSX, ODS, JSON)    (Válidos / Vacíos / Error)   • Acciones UI en 1 clic
  • Tabla en blanco desde cero   • 4 Lentes: Valores,           • Motor fx (48 funciones)
  • Obtener datos (Power BI UI):   Duplicados, Tipos, Rango       + Puente LLM JSON
    Web API, Wikipedia, SQL      • Inspector rápido de col.     • Ventana DuckDB Nativo
               │                              │                              │
               └──────────────────────────────┴──────────────────────────────┘
                                              ▼
               [4. Historial Determinista] ────────► [5. Salida y Reproducibilidad]
               • TableSession[] multi-pestaña        • Exportar Excel (.xlsx) / CSV
               • Fila con origIdx inmutable          • Exportar Apache Parquet (.parquet)
               • replayRecipeWithTrash()             • Guardar Receta (.refine.json)
               • Acordeones + Papelera                 (sin contraseñas embebidas)
```

### Cómo funciona la interfaz (Shell Fluent 2 Light)
- **Barra de Título y Búsqueda Global (`Ctrl+K`):** acceso rápido a archivo/exportación, título de sesión y buscador de acciones.
- **Cinta *Ribbon* (`Archivo`, `Inicio`, `Vista`, `Ayuda`):**
  - `Archivo` (Backstage): Crear **Nueva tabla**, Abrir archivos o plantillas, **Obtener datos**, importar/exportar Recetas y Exportar a Excel/CSV/Parquet.
  - `Inicio`: **Obtener datos**, **Plantilla rápida**, **Limpieza y Datos** (`Reemplazar`, `Duplicados`, `Tipo ▾`, `Errores ▾`), **Columnas y Forma** (`Dividir`, `Combinar`, `Extraer`, `Unpivot`, `1ª Fila Encab.`), homologación contextual de fechas y **DuckDB Nativo**.
- **Panel Izquierdo (*Perfil, Facetas y Clústeres*):** barra interactiva de calidad + 4 lentes de facetas + 5 algoritmos de clustering textual + acciones rápidas sobre la columna seleccionada.
- **Área Central (*Pestañas Multi-Sesión + Barra `fx` + Grid Virtualizado*):** múltiples tablas simultáneas (`TableSession[]`), creación de tablas en blanco, barra de fórmulas seguras `fx` con vista previa de 5 filas y tabla paginada en bloques de `100` filas para fluidez en datasets grandes.
- **Panel Derecho (*Datos y Pasos*):** botones definitivos de **Deshacer / Rehacer**, pestaña `Pasos` (acordeones activables en vivo), `Papelera` (filas eliminadas y columnas ocultas recuperables) y `Receta` (inspector JSON en vivo).

---

## 3. Cómo Funciona por Dentro (Guía de Arquitectura para Lectores y LLMs)

Esta sección resume los invariantes técnicos del código para que cualquier desarrollador o agente LLM entienda dónde vive cada responsabilidad sin recorrer todo el repositorio a ciegas:

### A. Modelo Determinista Basado en `origIdx` (`src/types/refine.ts`, `src/lib/refineEngine.ts`)
1. Cada `TableSession` guarda las filas originales cargadas (`baseRows`), asignando a cada fila un índice inmutable `origIdx: number`.
2. Ninguna transformación modifica `baseRows`. En su lugar, agrega un `TransformStep` (con `kind: TransformKind`, `column`, `enabled`, `params`) al arreglo `steps`.
3. Ante cualquier cambio (nuevo paso, activar/desactivar checkbox, reordenar o borrar paso), la función pura **`replayRecipeWithTrash`** recalcula desde `baseRows` el conjunto activo de filas (`activeRows`), columnas actuales y el estado de `trash`.
4. **Por qué importa:** permite activar/desactivar pasos intermedios en tiempo real y restaurar filas de la papelera (`restore_rows`) a su orden original sin corromper índices.

### B. Motor Dual: TypeScript Puro + Rust Nativo + DuckDB Nativo
- **Capa Web / Browser (`npm run dev`):**
  - Toda la lógica de recetas, parsing CSV/Excel (`xlsx`), perfilado de calidad, facetas, clustering de 5 niveles, fórmulas `fx` y conectores Web/Wikipedia (vía `fetch`/MediaWiki API) funciona directamente en el navegador.
- **Capa Escritorio Tauri v2 (`npm run dev:desktop`):**
  - El puente **`src/lib/tauriBridge.ts`** detecta el runtime Tauri (`isTauriDesktopRuntime()`) y delega tareas intensivas o privilegiadas al backend Rust (`src-tauri/src/lib.rs` → crate `modern_refine_engine` en `src-rust/`):
    - **Clustering y Perfilado Paralelo (`rayon` + `strsim`):** comandos `refine_cluster`, `refine_profile_column`, `refine_split_latin_name`.
    - **Conectores Snapshot sin CORS (`reqwest`):** comandos `preview_external_source` y `fetch_external_snapshot`.
    - **Motor DuckDB Nativo en Memoria (`src-rust/src/duckdb_engine.rs`):** `DuckDbState(Mutex<Option<DuckDbEngine>>)` sincroniza la sesión activa mediante `duckdb::Appender` (`duckdb_sync_session`) y ejecuta:
      - `duckdb_query_preview` (SQL `SELECT`/`WITH` validado en solo lectura).
      - `duckdb_group_summary` (agregaciones `COUNT`, `SUM`, `AVG`, `MIN`, `MAX` con apertura en nueva pestaña).
      - `duckdb_evaluate_window_magic` (fórmulas de ventana y anomalías: `RUNNING_SUM`, `PCT_OF_TOTAL`, `GROUP_AVG`, `ROW_NUM`, `IS_OUTLIER`).
      - `duckdb_export_parquet` (exportación columnar nativa `.parquet` con diálogo *Guardar como...* del sistema operativo).
  - En Windows, **`src-tauri/build.rs`** localiza y copia automáticamente `duckdb.dll` junto al binario ejecutable en `target/debug` o `target/release`.

### C. Motor de Fórmulas `fx` y Puente LLM (`src/lib/formula/`)
- Parser e intérprete propio (sin `eval` de JavaScript) compuesto por: `tokenizer.ts` → `parser.ts` (AST) → `validator.ts` → `evaluator.ts`.
- **`registry.ts` define 48 funciones en 5 categorías:**
  - `texto` (16), `logica` (12), `mexico` (8: validación/limpieza de CURP, RFC, CP, teléfono, etc.), `fechas` (7) y `numeros` (5).
- **`llmHelper.ts` (Puente LLM):** genera un *prompt* contextual con el esquema de la tabla activa (`buildLlmPromptForTable`) y parsea respuestas JSON estructuradas (`parseFormulaOrLlmJson`) para aplicar fórmulas o recetas sugeridas por cualquier LLM externo sin acoplar llaves de API ni telemetría.

### D. Seguridad e Ingesta *Snapshot* (`src/components/GetDataWizard.tsx`, `src/lib/sourceParsers.ts`, `src-rust/src/sources.rs`)
- Las fuentes SQL y externas operan bajo modo **Importar (Snapshot)**: descargan un corte de datos (por ejemplo `TOP 1000` / `LIMIT` o consulta `SELECT`) hacia una tabla local limpia.
- `validate_sql_read_only` bloquea sentencias destructivas (`DROP`, `DELETE`, `UPDATE`, `INSERT`, `ALTER`, etc.).
- `sanitizeSourceDescriptor` elimina usuarios, contraseñas y tokens Bearer antes de guardar `source` dentro de `.refine.json`. Las credenciales por nivel (`servidor` vs `servidor;BaseDeDatos`) viven únicamente en caché de memoria durante la sesión.

---

## 4. Estructura Completa de Carpetas y Archivos

```text
modern-refine/
├── index.html                          # Punto de entrada HTML (Vite)
├── package.json                        # Scripts (dev, dev:desktop, build, build:desktop) y deps JS
├── tsconfig.json                       # Configuración TypeScript estricto (~6.0)
├── vite.config.ts                      # Puerto 5174 + exclusión de */target/** en file watcher
├── AGENTS.md                           # Reglas de oro y guía de trabajo para desarrolladores/agentes
├── README.md                           # Documentación principal del proyecto (este archivo)
├── CHANGELOG,md                        # Registro cronológico de versiones (0.1.0-proto → 0.5.1)
├── clientes_sucursales_sucios.csv      # Plantilla sintética de pruebas (34 filas, 9 columnas)
├── mR_harmonia_cutout.png              # Logotipo oficial de ModernRefine
│
├── public/
│   ├── favicon.svg                     # Favicon vectorial
│   └── mR_harmonia_cutout.png          # Asset público del logo para UI
│
├── docs/                               # Especificaciones, guías y planes de evolución
│   ├── GUIA_APRENDIZ_RECETAS_Y_FORMULAS.md
│   ├── PROPUESTA_CONECTORES_SQL_Y_GET_DATA.md
│   ├── HOW_TO_CONECTORES_Y_GET_DATA.md
│   ├── PLAN_EVOLUCION_FORMULAS_DUCKDB_NATIVO.md
│   └── TAREAS_PENDIENTES_INTEGRACION_ANALYTICRAFT.md
│
├── src/                                # Frontend React 19 + TypeScript
│   ├── main.tsx                        # Montaje de la app React
│   ├── App.tsx                         # Shell principal: Ribbon, Backstage, Grid, Sesión, Modales
│   ├── App.css                         # Sistema visual Office / Fluent 2 Light
│   ├── vite-env.d.ts
│   ├── styles/
│   │   └── tokens.css                  # Design tokens (paleta clara, tipografía, bordes, acentos)
│   ├── types/
│   │   └── refine.ts                   # Tipos core: TableSession, TransformStep, TransformKind, Source*
│   ├── assets/icons/
│   │   └── FluentIcons.tsx             # Iconos Fluent personalizados
│   ├── data/
│   │   └── csvTemplates.ts             # Descubrimiento automático de plantillas .csv en raíz
│   ├── components/
│   │   ├── Icon.tsx                    # Wrapper unificado para lucide-react / FluentIcons
│   │   ├── SmartFacetsPanel.tsx        # Barra de calidad + 4 lentes de facetas + clústeres
│   │   ├── ActionModals.tsx            # Modales con vista previa: Reemplazar, Dedupe, Dividir,
│   │   │                               # Combinar, Extraer, Unpivot y Nueva tabla en blanco
│   │   ├── GetDataWizard.tsx           # Catálogo Power BI UI + Credenciales + Navegador de tablas
│   │   └── DuckDbModal.tsx             # Consola DuckDB Nativo: SQL, Group By, Ventana y Parquet
│   └── lib/
│       ├── refineEngine.ts             # Motor determinista de recetas, clustering TS, fechas y perfiles
│       ├── sourceParsers.ts            # Parsers Web JSON/CSV/Wikipedia + sanitización de credenciales
│       ├── tauriBridge.ts              # Abstracción híbrida Web vs IPC nativo Tauri v2
│       └── formula/                    # Motor fx seguro sin eval()
│           ├── errors.ts
│           ├── tokenizer.ts
│           ├── parser.ts
│           ├── validator.ts
│           ├── evaluator.ts
│           ├── registry.ts             # Catálogo de 48 funciones (texto, lógica, fechas, números, mx)
│           └── llmHelper.ts            # Generador de prompts y parser de respuestas JSON de LLM
│
├── src-rust/                           # Crate Rust puro "modern_refine_engine" (sin UI)
│   ├── Cargo.toml                      # Dependencias: duckdb 1.20000.2, calamine, rayon, strsim, csv
│   └── src/
│       ├── lib.rs                      # Clustering 5 niveles paralelo, nombres LatAm, Excel, perfilado
│       ├── sources.rs                  # Trait DataSource, parsers HTML/JSON/CSV y validación SQL read-only
│       └── duckdb_engine.rs            # Motor DuckDbEngine: Appender, SQL, Group By, Ventana y Parquet
│
└── src-tauri/                          # Contenedor nativo de escritorio Tauri v2
    ├── Cargo.toml                      # Dependencias Tauri 2, plugin-dialog, plugin-opener, reqwest 0.13
    ├── tauri.conf.json                 # Config ventana (1360x840), puerto dev 5174 y bundle
    ├── build.rs                        # Copia automática de duckdb.dll junto al .exe en Windows
    └── src/
        ├── main.rs                     # Binario de arranque desktop
        └── lib.rs                      # Registro de 12 comandos IPC (refine_*, preview/fetch_*, duckdb_*)
```

> **Nota sobre tamaño en disco:** las carpetas generadas `src-tauri/target/`, `src-rust/target/`, `node_modules/` y `dist/` están ignoradas en `.gitignore`. Si necesitas liberar varios gigabytes de caché de compilación de Rust en tu equipo local, puedes ejecutar `cargo clean` dentro de `src-tauri/` y `src-rust/` sin afectar el código fuente.

---

## 5. Puesta en Marcha y Comandos de Desarrollo

### Requisitos previos
- **Node.js** (v18+ recomendado) y **npm**
- **Rust / Cargo** (para modo escritorio Tauri y pruebas del motor nativo)
- En Windows: **Microsoft Edge WebView2** y herramientas de compilación C++ (MSVC Build Tools)

### 1. Aplicación Nativa de Escritorio (Tauri v2 + DuckDB Nativo)
```bash
cd modern-refine
npm install
npm run dev:desktop
```
Esto inicia Vite en `http://localhost:5174` y abre la ventana nativa enlazada con `modern_refine_engine` y `duckdb.dll`.  
*(Si ya tenías corriendo `npm run dev` en el puerto `5174`, deténlo antes de lanzar `npm run dev:desktop`.)*

### 2. Solo Interfaz Web (Preview rápido en navegador)
```bash
cd modern-refine
npm run dev
```

### 3. Verificación, Pruebas y Build de Producción
```bash
# Validar TypeScript estricto y empaquetado frontend (desde modern-refine/)
npm run build

# Ejecutar suite de pruebas unitarias del motor Rust + DuckDB (desde modern-refine/src-rust/)
cargo test

# Verificar compilación del host Tauri (desde modern-refine/src-tauri/)
cargo check

# Generar instalador / ejecutable de producción
npm run build:desktop
```

---

## 6. Estado de Madurez y Hoja de Ruta

| Versión / Hito | Estado | Qué incluye |
|---|---|---|
| `0.1.0-proto` — Prototipo UI | `✅ Cerrada` | 3 zonas, `origIdx`, papelera, recetas `.refine.json`, homologación de fechas. |
| `0.2.0` — Motor Rust + Excel | `✅ Cerrada` | Crate `modern_refine_engine`, `.xlsx`/`.ods`, limpieza numérica/CP, clustering 5 niveles. |
| `0.3.0` — Multi-Sesión + Tauri v2 | `✅ Cerrada` | Múltiples pestañas, acordeones con checkbox maestro, nombres LatAm en 3 cols, paginación 100 filas, diálogo nativo *Guardar como...*. |
| `0.4.0` — Fluent 2 Light + `fx` + Facetas | `✅ Cerrada` | Rediseño Office/Fluent 2, motor `fx` (48 funciones + Puente LLM), 4 lentes de faceta y modales de limpieza con vista previa. |
| `0.4.1` — Obtener Datos (*Get Data*) | `✅ Cerrada` | Catálogo Power BI UI, conectores locales/Web/Wikipedia/SQL en modo Snapshot y credenciales por nivel sin fugas en `.refine.json`. |
| `0.5.0 / 0.5.1` — **DuckDB Nativo + Pulido** | `✅ Actual` | Motor DuckDB nativo en Rust (sin WASM), consola SQL/Group By/Ventana, exportación Parquet, tabla en blanco y UI depurada. |
| **Post-0.5.x — Evolución e Integración** | `🔜 Próximo` | Nuevas fórmulas mágicas de ventana/regex sobre DuckDB, uniones (`Append/Merge`) y migración bidireccional con Analyticraft. |

---

## 7. Documentación Relacionada

- [CHANGELOG,md](./CHANGELOG,md) — Historial técnico detallado de todas las versiones (`0.1.0-proto` a `0.5.1`).
- [AGENTS.md](./AGENTS.md) — Reglas de oro e invariantes del proyecto para desarrolladores y agentes IA.
- [Guía del Aprendiz: Recetas y Fórmulas](docs/GUIA_APRENDIZ_RECETAS_Y_FORMULAS.md) — Manual práctico para usuarios provenientes de Excel.
- [Propuesta de Conectores SQL y "Obtener Datos"](docs/PROPUESTA_CONECTORES_SQL_Y_GET_DATA.md) — Diseño de importación desacoplada (*Snapshot ETL*).
- [Guía Técnica How-To: Conectores y Get Data](docs/HOW_TO_CONECTORES_Y_GET_DATA.md) — Detalles de implementación, *traits* en Rust y ciberseguridad.
- [Plan de Evolución: Fórmulas Mágicas (`fx`) sobre DuckDB Nativo](docs/PLAN_EVOLUCION_FORMULAS_DUCKDB_NATIVO.md) — Hoja de ruta técnica tras eliminar WASM.
- [Tareas Diferidas para Integración con Analyticraft](docs/TAREAS_PENDIENTES_INTEGRACION_ANALYTICRAFT.md) — Plan para *Pivot*, *Append/Merge* y orquestación multi-tabla.
- [Analyticraft](https://github.com/seargentpepper/Analyticraft) — Repositorio padre del ecosistema.
