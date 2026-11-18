<p align="center">
  <img src="mR_harmonia_cutout.png" width="128" height="128" alt="ModernRefine icon">
</p>

<h1 align="center">ModernRefine</h1>

**Estación de limpieza de datos (*Pre-BI Cleaning Station*) minimalista y *local-first*: una reimplementación nativa de OpenRefine en Tauri v2, Rust y React, nacida como ejercicio independiente dentro del ecosistema [Analyticraft](https://seargentpepper.github.io/Analyticraft/).**

<p align="center">
  Diseñada para transformar archivos CSV, TSV, Excel y JSON masivos o sucios en tablas confiables en menos de 10 minutos, sin escribir una sola línea de código, sin miedo a perder información y dejando una receta reproducible (<code>.refine.json</code>). Corre de forma nativa en Windows, macOS y Linux.
</p>

<p align="center">
  <img alt="Status: active" src="https://img.shields.io/badge/status-active%20development-007acc?style=flat-square">
  <img alt="Tauri v2 (Rust)" src="https://img.shields.io/badge/Tauri%20v2%20(Rust)-Native%20Desktop-orange?style=flat-square">
  <img alt="React 19 + TypeScript + Vite 8" src="https://img.shields.io/badge/React%2019%20%2B%20TS%20%2B%20Vite%208-UI-blue?style=flat-square">
  <img alt="Motor Rust: rayon + calamine" src="https://img.shields.io/badge/Rust%20Engine-rayon%20%2B%20calamine-blueviolet?style=flat-square">
</p>

<br>

---

## ¿Por qué existe ModernRefine? (Más allá de los límites de Excel)

Quien trabaja todos los días con bases de datos, padrones o exportaciones de ERP en **Excel** conoce la frustración:
- **Excel se congela** cuando abres archivos de cientos de miles de filas o aplicas múltiples filtros y fórmulas encadenadas.
- **Excel altera tus datos en silencio:** borra ceros iniciales en códigos postales (`08600` → `8600`), convierte textos en fechas erróneas o mezcla formatos regionales.
- **Miedo a equivocarse:** un `Buscar y Reemplazar` mal aplicado sobre 200,000 registros puede arruinar el archivo sin posibilidad real de auditar qué cambió.

**ModernRefine** nace como una herramienta independiente —y antesala natural de **Analyticraft**— para resolver exactamente ese problema desde la raíz:

1. **Cero ansiedad al editar (Todo es reversible):** Cada limpieza se guarda como un paso en un historial con acordeones. Puedes apagar, encender o borrar cualquier paso en vivo y recuperar filas o columnas ocultas desde la **Papelera**.
2. **Pensado para tablas grandes:** Gracias a la **paginación virtualizada** (bloques de 100 filas en pantalla) y al motor paralelo en **Rust**, la interfaz mantiene fluidez sin cargar cientos de miles de nodos en memoria.
3. **Recetas reproducibles (`.refine.json`):** Si cada lunes recibes el mismo reporte sucio de sucursales o clientes, limpias una vez, guardas la receta y la reaplicas en segundos la próxima semana.

---

## Cómo funciona esta reimplementación de OpenRefine

A diferencia del OpenRefine clásico (basado en servidor Java + navegador web), **ModernRefine** traslada esa filosofía a una aplicación de escritorio ligera y directa en **3 zonas sincronizadas**:

| Zona / Capacidad | Cómo funciona en ModernRefine | Beneficio Práctico |
|---|---|---|
| **1. Panel de Facetas y Clústeres** | Agrupa valores únicos ($U$) y ejecuta 5 algoritmos en paralelo para detectar variantes que significan lo mismo. | Ves en segundos qué está sucio, cuántos vacíos hay y fusionas variantes con 1 clic (`Elegir`), sin fusiones automáticas peligrosas. |
| **2. Tabla Editable Virtualizada** | Muestra sesiones independientes por pestaña (`TableSession[]`) con bloques de 100 filas, ordenamiento tipado (`↕ / ↑ / ↓`) y edición directa. | Puedes abrir y limpiar varias tablas a la vez sin mezclar sus historiales ni saturar la RAM. |
| **3. Historial, Papelera y Receta** | Agrupa los pasos en acordeones por columna/tarea con *checkbox maestro*, papelera de recuperación y exportación `.refine.json`. | Trazabilidad total: sabes exactamente qué se transformó, en qué orden y puedes revertirlo al instante. |

---

## Motor de Clustering (5 Niveles sobre Valores Únicos)

Para mantener latencias de **<15 ms** incluso en tablas grandes, el clustering se ejecuta sobre los **valores únicos de la faceta ($U$)** y no sobre todas las filas ($N$), usando ejemplos reales del español y de México:

1. **Fingerprint:** Quita acentos, espacios, puntuación y ordena palabras (`Mérida Yucatán` ↔ `yucatan merida`).
2. **N-gram Fingerprint:** Detecta errores de tecleo y letras intercambiadas (`Guadalajara` ↔ `Gaudalajara`).
3. **Levenshtein / Distancia de Edición:** Mide ediciones mínimas (`Monterrey` ↔ `Monterey`).
4. **Fonético en Español:** Agrupa variantes que suenan igual (`Cancún` ↔ `Kankun`, `Xalapa` ↔ `Jalapa`).
5. **Subsecuencia Consonántica / Abreviaturas:** Detecta abreviaturas comunes en México y el sureste mexicano (`CDMX` ↔ `Ciudad de México`, `Gdl` ↔ `Guadalajara`, `Mty` ↔ `Monterrey`, `Q. Roo` ↔ `Quintana Roo`).

---

## Transformaciones en 1 Clic

- **Texto:** `Quitar espacios`, `MAYÚSCULAS`, `minúsculas`, `Tipo Título`, `Sin acentos`, `Solo números`, `CP 5 dígitos (0...)`.
- **Estructura y División de Columna (`Alt+D/R/X/2/I/U/N`):**
  - `Duplicar columna`, `Renombrar columna`, `Borrar (desaparecer) columna` (no destructivo, recuperable desde `Papelera`).
  - `Dividir en 2 columnas (por "-")`, `Conservar izquierda` y `Conservar derecha`.
  - **Separador inteligente de nombres latinoamericanos:** Genera las 3 columnas clásicas (`Nombre(s)`, `Apellido_Paterno`, `Apellido_Materno`) agrupando partículas (`de`, `del`, `de la`) y distinguiendo nombres compuestos (`Juan Carlos Méndez`) de `1 nombre + 2 apellidos` (`Ana López Pérez`).
- **Vacíos y Filas:** `Vacíos → Sin dato`, `Rellenar abajo` (*Fill Down*), `Eliminar filas vacías` y eliminación individual de fila con recuperación en **Papelera**.
- **Fechas:** Homologación masiva contextual con 7 formatos (`ISO AAAA-MM-DD`, `DD/MM/AAAA`, `AAAA/MM/DD`, `DD-MM-AAAA`, `MM/DD/AAAA`, `14-ene-2025`, `14 de enero de 2025`).
- **Exportación Nativa:** Diálogo nativo del sistema operativo (*Guardar como...* en Windows, macOS y Linux) para **Excel (`.xlsx`)**, **CSV (`.csv`)** y **Recetas (`.refine.json`)**.

---

## Puesta en Marcha (Desarrollo Local)

### 1. Ventana Nativa de Escritorio (Recomendado)
Para abrir **ModernRefine** en su propia ventana independiente (menor consumo de RAM y conexión directa con el motor Rust):
```bash
cd modern-refine
npm install
npm run dev:desktop
# o alternativamente:
npm run tauri dev
```

### 2. Modo Navegador Web (Preview Rápido de UI)
```bash
cd modern-refine
npm run dev
```
Se abrirá en `http://localhost:5174`. Puedes abrir cualquier archivo `.csv`, `.xlsx`, `.ods`, `.tsv` o `.json` local, o cargar la plantilla incluida en la raíz (`clientes_sucursales_sucios.csv`).

---

## Alcance del MVP y Plan de 6 Semanas

| Fase | Estado | Entregables Clave |
|---|---|---|
| **Semana 1 — Prototipo UI** | `✅ Cerrada` | Pantalla de 3 zonas, inicio limpio, plantillas CSV en raíz, facetas, clústeres, homologación contextual de fechas, historial y papelera. |
| **Semana 2 y 3 — Motor Rust + Excel Multi-Hoja** | `✅ Cerrada` | Lectura/exportación `.xlsx`/`.ods`/`.tsv`/`.json`, auto-detección de separador, limpieza de números/CP y 5 algoritmos de clustering en paralelo (`src-rust/`). |
| **Semana 3 y 4 — Multi-Sesión, Acordeones y Desktop** | `✅ Implementada` | Sesiones multi-pestaña (`TableSession[]`), acordeones con checkbox maestro, nombres en 3 columnas, ventana virtualizada, contenedor Tauri v2, diálogo nativo *Guardar como...* y scrollbars azul oscuro. |
| **Semana 5 y 6 — Pruebas Reales y Empaquetado** | `🔜 Siguiente` | Validación con 5 archivos Excel reales sucios y generación de instaladores nativos (`npm run build:desktop`). |

---

## Documentación Relacionada

- [CHANGELOG](CHANGELOG) — Historial detallado de versiones y cambios técnicos.
- [AGENTS.md](AGENTS.md) — Convenciones y guía técnica para desarrollo.
- [README de Analyticraft](https://github.com/seargentpepper/Analyticraft) — Proyecto principal del ecosistema.
