# ModernRefine

Mini-aplicación independiente de limpieza de datos (*Pre-BI Cleaning Station*) desarrollada como subproyecto aislado antes de su integración en **Analyticraft**.

> **Público objetivo:** Quien vive en Excel y recibe datos sucios de todos lados.  
> **Propósito único:** Pasar de un Excel o CSV sucio a un archivo confiable en menos de 10 minutos, sin escribir código, sin miedo a equivocarse y dejando una receta reproducible (`.refine.json`).

---

## Puesta en Marcha (Desarrollo Local)

```bash
cd modern-refine
npm install
npm run dev
```

Se abrirá en `http://localhost:5174`. Puedes abrir cualquier `.csv` local o cargar las plantillas colocadas en la raíz (`modern-refine/*.csv`).

---

## Los 3 Trabajos Concretos

1. **Ver qué está sucio:** Muestra en segundos cuántas variantes únicas, celdas vacías, espacios extra y fechas inválidas existen por columna.
2. **Decidir qué es lo mismo:** Agrupa variantes similares (`Villahermosa`, `VillaHermosa`, `Vhsa`, `V. Hermosa`, `Villahermosa Tab.`) y permite elegir el valor definitivo con un clic (`Elegir`), sin fusionar nada automáticamente.
3. **Dejar rastro reproducible:** Cada transformación, edición o eliminación queda registrada en el historial con soporte de activación/desactivación en vivo, papelera de recuperación y exportación/importación de receta (`.refine.json`).

---

## Stack y Arquitectura Técnica

```text
ModernRefine (/modern-refine)
├── 🖥️ Interfaz (Tauri v2 + React 19 + TypeScript + CSS Workbench Industrial)
│   ├── Tabla editable con navegación por teclado y resaltado de celda/fila
│   ├── Panel de Facetas, Clústeres y Homologación de Fechas
│   └── Historial de Pasos (Toggle / Eliminar / Papelera / Receta JSON)
│
├── ⚙️ Motor Objetivo (Rust Ligero + DuckDB)
│   ├── Ingesta y Exportación: calamine (XLSX/ODS), rust_xlsxwriter, csv, serde
│   ├── Facetas y Filtros: DuckDB (GROUP BY, conteos y filtros en 10–40 ms)
│   └── Clustering en Paralelo: rayon + strsim + unicode-normalization
│
└── 📦 Convivencia con Analyticraft
    └── Salida limpia (.xlsx / .csv) + Receta (.refine.json) hacia /data/
```

---

## Motor de Clustering (5 Niveles sobre Valores Únicos)

Para mantener latencias de **<15 ms**, el clustering se ejecuta sobre los **valores únicos de la faceta ($U$)** y no sobre todas las filas ($N$):

1. **Fingerprint:** Quita acentos, espacios, puntuación y ordena palabras (`Villa Hermosa` ↔ `hermosa villa`).
2. **N-gram Fingerprint:** Detecta errores de tecleo y letras intercambiadas.
3. **Levenshtein / Distancia de Edición:** Mide ediciones mínimas (`Villahermosa` ↔ `Villahermsoa`).
4. **Fonético en Español:** Agrupa variantes que suenan igual (`Villa Hermosa` ↔ `Biya Hermosa`).
5. **Subsecuencia Consonántica / Abreviaturas:** Detecta abreviaturas comunes (`Vhsa` ↔ `Villahermosa`, `Tab.` ↔ `Tabasco`).

---

## Transformaciones en 1 Clic

- **Texto:** `Quitar espacios`, `MAYÚSCULAS`, `minúsculas`, `Tipo Título`, `Sin acentos`.
- **Vacíos y Filas:** `Vacíos → Sin dato`, `Rellenar abajo` (*Fill Down*), `Eliminar filas vacías` y eliminación individual de fila con recuperación en **Papelera**.
- **Fechas:** Homologación masiva con selector de columna y 7 formatos (`ISO AAAA-MM-DD`, `DD/MM/AAAA`, `AAAA/MM/DD`, `DD-MM-AAAA`, `MM/DD/AAAA`, `14-ene-2025`, `14 de enero de 2025`) preservando fechas inválidas sin corromperlas.
- **Facetas:** Renombrado masivo de etiquetas de faceta y alias personalizado para filtros activos.

---

## Alcance del MVP y Plan de 6 Semanas

- **Semana 1 — Prototipo UI (`✅ Fase 1 Cerrada`):** Pantalla de 3 zonas, inicio limpio con selector reversible, plantillas CSV en raíz, selección de columna completa, facetas, clústeres con selección directa, homologación contextual de fechas, historial editable y papelera.
- **Semana 2 y 3 — Motor en Rust + DuckDB (`✅ Implementado / En Pruebas QA`):** Lectura/exportación `.xlsx`/`.ods`/`.tsv`, auto-detección de separador, transformaciones de números/CP/separación, los 5 algoritmos de clustering en paralelo y crate nativo `src-rust/`.
- **Semana 3 y 4 — Virtualización 500k+ Filas y Puente Tauri:** Conexión IPC directa UI ↔ `src-rust/` y paginación virtualizada.
- **Semana 5 y 6 — Pruebas con Datos Reales:** Validación con 5 archivos Excel reales sucios.

---

## Documentación Relacionada

- **Lista de retos QA (Semana 2 y 3):** [`./RETOS_QA_S2_S3.md`](./RETOS_QA_S2_S3.md)
- **Especificación técnica completa:** [`../docs/ModernRefine`](../docs/ModernRefine)
- **Historial de cambios del subproyecto:** [`./CHANGELOG`](./CHANGELOG)
