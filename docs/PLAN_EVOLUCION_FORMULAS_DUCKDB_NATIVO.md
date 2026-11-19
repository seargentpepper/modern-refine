# Plan de Evolución: Fórmulas Mágicas (`fx`) sobre DuckDB Nativo (Sin WASM)

> **Estado:** Diferido estratégicamente (Fase Post-Migración).  
> **Condición de arranque:** Se ejecutará una vez confirmada y validada la transición de **Analyticraft + ModernRefine** al motor **DuckDB nativo en Rust** (eliminando `@duckdb/duckdb-wasm`).

---

## 1. Principio de Continuidad: Cero Ruptura con el Motor Actual

El motor actual de fórmulas (`src/lib/formula/`) opera mediante un evaluador AST propio en TypeScript puro sobre objetos fila (`DataRow`), manteniendo **47 funciones** (Texto, Lógica, Números, Fechas y utilidades de México como `NORMALIZE_PHONE_MX`, `PAD_CP`, `NORMALIZE_CURP`, `NORMALIZE_RFC`).

Al adoptar DuckDB nativo en Rust:
- **Todas las recetas `.refine.json` existentes siguen funcionando sin cambios.**
- **Las funciones locales y mexicanas se conservan intactas** en el registro propio (`FORMULA_REGISTRY`).
- La barra **`Fórmula (fx)`**, el recetario rápido, `Probar 5 filas` y **`Copiar para LLM`** mantienen exactamente la misma sintaxis `[Columna]`.

---

## 2. Nuevas Familias de "Fórmulas Mágicas" Desbloqueadas

Hoy `evaluateFormulaAst(ast, row)` solo ve **una fila aislada a la vez**. Con DuckDB nativo en el backend Rust, el motor puede evaluar fórmulas con **contexto de toda la columna, filas vecinas y otras pestañas abiertas** a velocidad C++:

### 1. Fórmulas de Ventana y Contexto entre Filas (`LAG` / `LEAD` / Acumulados)
- `RUNNING_SUM([Monto_MXN])`: Suma acumulada fila por fila.
- `PREV_ROW([Fecha_Alta])` / `DIFF_PREV([Saldo])`: Compara una fila contra la anterior (ej. días transcurridos entre pedidos o variación de saldo).
- `ROW_NUM([Ciudad])` / `RANK_BY([Monto_MXN], [Estado])`: Enumerar o rankear registros dentro de cada sucursal o estado.
- *Equivalencia DuckDB:* `SUM(...) OVER (...)`, `LAG(...) OVER (...)`, `ROW_NUMBER() OVER (PARTITION BY ...)`.

### 2. Agregaciones Inline sin Destruir la Tabla (`OVER PARTITION`)
Sin necesidad de colapsar el grano fino de la tabla con un *Group By*:
- `PCT_OF_TOTAL([Monto_MXN])`: Porcentaje que representa cada venta sobre el total de la columna.
- `GROUP_AVG([Monto_MXN], [Ciudad])` / `GROUP_SUM([Monto_MXN], [Ciudad])`: Coloca al lado de cada cliente el promedio o total de su ciudad para comparar contra la media.
- *Equivalencia DuckDB:* `val * 100.0 / SUM(val) OVER ()`, `AVG(val) OVER (PARTITION BY Ciudad)`.

### 3. `LOOKUP` entre Pestañas (Tipo `XLOOKUP` / `VLOOKUP` Nativo)
Dado que todas las sesiones/tablas activas pueden residir como tablas reales en la misma instancia `.duckdb`:
- `LOOKUP([Codigo_Postal], "Catalogo_SEPOMEX", "CP", "Municipio")`: Enriquecer una columna cruzándola contra otro archivo abierto en segundos, incluso con cientos de miles de filas.
- *Equivalencia DuckDB:* `LEFT JOIN` indexado en memoria/disco sobre la tabla destino preservando `origIdx`.

### 4. Detección Estadística de Anomalías (Integrada a Calidad)
DuckDB nativo calcula percentiles y desviaciones estándar en milisegundos:
- `IS_OUTLIER([Monto_MXN])` / `ZSCORE([Monto_MXN])`: Marcar automáticamente montos atípicos o errores de captura (ej. `1500000` en lugar de `1500.00`) usando `STDDEV` y `QUANTILE_CONT` (IQR).

### 5. Similitud Fuzzy y Regex Nativo de Alto Rendimiento (RE2)
DuckDB nativo incluye expresiones regulares RE2 en C++ y métricas de distancia de texto:
- `REGEX_EXTRACT([Texto], "([A-Z]{4}\\d{6})")`: Extraer patrones complejos (RFC, folios de factura, claves de rastreo) sobre 1M+ filas sin bloquear React.
- `FUZZY_MATCH([Ciudad], "Villahermosa")`: Calcular similitud (`jaro_winkler_similarity`) contra un valor canónico dentro de fórmulas `IF(...)`.

---

## 3. Arquitectura de Ejecución Híbrida (Plan Técnico)

1. **Clasificación en el Validador AST (`validator.ts`):**
   - Cada función en `FORMULA_REGISTRY` declarará su alcance: `scope: "row" | "window" | "cross_table"`.
   - Las fórmulas `"row"` pueden previsualizarse al instante en JS para 5 filas o ejecutarse en Rust.
   - Las fórmulas `"window"` y `"cross_table"` se compilan desde el AST validado hacia SQL seguro de DuckDB nativo (con identificadores escapados y cero concatenación libre de usuario).
2. **Seguridad y Determinismo:**
   - El orden de las filas en funciones de ventana (`LAG`, `RUNNING_SUM`) siempre usará `ORDER BY origIdx` (o el ordenamiento explícito definido en el paso) para garantizar que la receta `.refine.json` sea 100% reproducible.
3. **Actualización del Puente LLM (`llmHelper.ts`):**
   - Al activarse este motor, `buildLlmPromptForTable` incluirá automáticamente las nuevas funciones permitidas y la lista de otras tablas abiertas disponibles para `LOOKUP(...)`.

---

## 4. Criterio de Activación

Este plan permanece **en espera** hasta cumplir estos 3 hitos previos:
1. Retirar `@duckdb/duckdb-wasm` de Analyticraft.
2. Integrar `modern_refine_engine` + DuckDB nativo en el workspace Rust compartido de Analyticraft.
3. Confirmar estabilidad y rendimiento de tablas reales en escritorio sin WASM.
