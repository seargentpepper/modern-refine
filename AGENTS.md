# AGENTS.md: Guía de Trabajo en ModernRefine

Lee este archivo primero en cada sesión. Es la guía canónica para desarrolladores y agentes de IA que trabajan en **ModernRefine** (subproyecto aislado dentro de **Analyticraft**).

---

## 1. Qué es ModernRefine

**ModernRefine** es una estación de limpieza de datos de escritorio (*Pre-BI Cleaning Station*), *offline-first* y sin código, diseñada para transformar archivos sucios (`.csv`, `.tsv`, `.xlsx`, `.xls`, `.ods`) en datos confiables y recetas reproducibles (`.refine.json`) antes de pasarlos a **Analyticraft**.

- **Estado actual:** `v0.2.0` — Fase 1 (Prototipo UI 3 zonas) cerrada; Fase 2 (Semana 2 y 3: clustering de 5 niveles, soporte Excel multi-hoja y crate nativo en Rust `modern_refine_engine`) implementada y en pruebas QA.
- **Estilo visual:** *CSS Workbench Industrial* propio (`#1e1e1e`, `#252526`, `#2d2d2d`, `#007acc`) + `lucide-react`, derivado directamente de Analyticraft.

### Orientación Rápida

| Documento | Propósito |
|---|---|
| [`README.md`](./README.md) | Portada del subproyecto: puesta en marcha, stack y estado del MVP |
| [`CHANGELOG`](./CHANGELOG) | Historial detallado de cambios y aprendizajes de ModernRefine |
| [`RETOS_QA_S2_S3.md`](./RETOS_QA_S2_S3.md) | Lista de pruebas manuales (QA) para validar UI y motor |
| [`../docs/ModernRefine`](../docs/ModernRefine) | Especificación técnica completa y plan de 6 semanas |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Principios de ingeniería y control de *Blast Radius* de Analyticraft |
| [`../CHANGELOG.md`](../CHANGELOG.md) | Historial general de Analyticraft |

---

## 2. Mapa de Capas y Estructura

| Capa | Ruta | Responsabilidad |
|---|---|---|
| **UI / Frontend** | `src/App.tsx`, `src/App.css`, `src/types/refine.ts` | Interfaz de 3 zonas (*Facetas y Clústeres*, *Tabla Editable*, *Historial / Papelera / Receta*), navegación por teclado y exportación |
| **Motor Web (Prototipo)** | `src/lib/refineEngine.ts`, `src/data/csvTemplates.ts` | Parser CSV/TSV con auto-detección, clustering de 5 niveles, homologación de fechas y motor determinista `replayRecipeWithTrash` |
| **Motor Nativo (Rust)** | `src-rust/src/lib.rs`, `src-rust/Cargo.toml` | Crate `modern_refine_engine`: lectura Excel (`calamine 0.38`) y clustering paralelo (`rayon`, `strsim`, `unicode-normalization`) |
| **Plantillas de Prueba** | `clientes_sucursales_sucios.csv` | Plantilla sintética en raíz (34 filas, 9 columnas) compatible con recetas de Fase 1 |

---

## 3. Reglas de Oro

1. **No romper UI ni backend corroborado:** Cualquier mejora debe anidarse sin alterar controles existentes que ya funcionan ni romper la retrocompatibilidad con recetas `.refine.json` (`schema: "modern-refine/v1"`).
2. **Nunca fusionar sin confirmación:** El motor propone grupos de clústeres; el usuario siempre decide con un clic (`Elegir` / `Fusionar`).
3. **Identidad estable por fila (`origIdx`):** Todas las ediciones, eliminaciones (`delete_row`, `delete_empty_rows`) y restauraciones (`restore_rows`) deben operar sobre `origIdx` para que activar, desactivar o eliminar pasos intermedios nunca corrompa la cadena.
4. **Exclusión en clustering:** Nunca ejecutar *Levenshtein*, *N-gram* ni *Abreviatura* sobre columnas de fechas, columnas numéricas o cadenas con dígitos.
5. **Controles contextuales:** Las barras exclusivas de un tipo de dato (como `Reformatear toda la columna` de fechas) solo se muestran cuando la columna seleccionada corresponde a ese tipo (`isLikelyDateColumn`).
6. **Sin `panic!` ante datos sucios:** Los parsers de CSV, Excel y fechas deben tolerar archivos malformados devolviendo `Result` en Rust o preservando el valor intacto sin cerrar la app.
7. **Offline-first y cero datos privados en el repo:** Ninguna llamada de red ni telemetría. Nunca subir archivos `.csv` o `.xlsx` reales de clientes/empresas al repositorio; usar solo plantillas sintéticas.
8. **Inicio limpio:** La aplicación debe arrancar sin datos de muestra precargados; las plantillas se cargan bajo demanda desde la raíz.

---

## 4. Build, Pruebas y Validación

```bash
# Frontend (desde modern-refine/)
npm install
npm run dev          # Inicia en http://localhost:5174
npm run build        # Verifica TypeScript estricto (tsc) + bundle Vite

# Motor Nativo Rust (desde modern-refine/src-rust/)
cargo test           # Ejecuta pruebas unitarias de modern_refine_engine
cargo clippy -- -D warnings
cargo fmt --check
```

---

## 5. Definición de Done (DoD)

Antes de dar por cerrada una tarea en `modern-refine/`:
- [ ] `npm run build` (`tsc && vite build`) pasa con 0 errores.
- [ ] Si se tocó `src-rust/`, `cargo test` pasa al 100%.
- [ ] Se probó retrocompatibilidad con recetas `.refine.json` previas.
- [ ] Cambios documentados en [`CHANGELOG`](./CHANGELOG) y [`README.md`](./README.md) cuando aplique.
- [ ] Sin datos privados ni archivos temporales en el staging de Git.
