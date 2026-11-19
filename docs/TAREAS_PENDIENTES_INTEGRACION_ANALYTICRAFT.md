# Tareas Diferidas para la Integración con Analyticraft

> **Propósito:** Registrar formalmente las operaciones que no forman parte de la estación de limpieza en memoria de tabla única (ModernRefine standalone v0.4), pero que **sí se ejecutarán cuando ModernRefine se fusione como motor nativo de preparación (ETL pre-BI) dentro de Analyticraft**.

---

## 1. Por qué estas tareas se difieren estratégicamente

ModernRefine en su versión autónoma resuelve con máxima agilidad el **90% del trabajo cotidiano de Excel/CSV**: perfilar, tipar, depurar caracteres invisibles, deduplicar, homologar con clustering de 5 niveles, reemplazar y reorganizar columnas (*Unpivot*) preservando el historial reproducible por fila inmutable (`origIdx`).

Las siguientes operaciones rompen la premisa de "limpieza en memoria de una sola tabla plana" y **pertenecen naturalmente a Analyticraft**, donde ya reside el motor OLAP analítico (DuckDB / Polars), el modelador multidimensional y el gestor de catálogo:

---

## 2. Inventario de Tareas Diferidas (Backlog para Analyticraft)

### A. Operaciones de Reshaping y Agregación
1. **Group By (Agrupar por con Suma, Conteo, Promedio, Máx/Mín):**
   - *Por qué se difiere:* El agrupamiento destruye la granularidad fina de las filas, impidiendo clustering posterior o auditoría celda a celda en la tabla original.
   - *Implementación en Analyticraft:* Generará una **vista agregada derivada** en DuckDB (`CREATE VIEW ... AS SELECT ... GROUP BY`) sin mutar destructivamente la tabla de hechos base.
2. **Pivot (Filas a Columnas):**
   - *Por qué se difiere:* Genera un número indeterminado de columnas dependientes de los valores del dataset. Si los valores cambian la siguiente semana, el esquema de la receta se vuelve inestable.
   - *Implementación en Analyticraft:* Ejecutado como sentencia declarativa `PIVOT` de DuckDB para cubos analíticos.
3. **Transponer Tabla (Filas ↔ Columnas):**
   - *Por qué se difiere:* Solo aplica a matrices pequeñas de presentación. En tablas grandes de miles de filas provocaría explosión del conteo de columnas.
   - *Implementación en Analyticraft:* Módulo visual de reportes ejecutivos.

### B. Relaciones Multi-Tabla y Fusión de Fuentes
4. **Append de Consultas (Apilar varios archivos/tablas en una sola):**
   - *Por qué se difiere:* Requiere validar compatibilidad de esquemas entre múltiples orígenes y coordinar identidades de fila compuestas.
   - *Implementación en Analyticraft:* `UNION ALL` nativo de DuckDB con reconciliación de esquemas en el catálogo unificado.
5. **Merge / Join de Consultas (Cruzar tablas por clave tipo VLOOKUP/SQL JOIN):**
   - *Por qué se difiere:* Involucra lógica relacional (Left, Inner, Full Outer) que pertenece a la capa de modelado dimensional, no a la preparación cosmética de una hoja aislada.
   - *Implementación en Analyticraft:* Modelador gráfico de relaciones (Diagrama Entidad-Relación de Analyticraft).

### C. Automatización y Asistencia Avanzada
6. **Columna Condicional con Constructor Gráfico (UI sin fórmulas):**
   - *Estado actual:* Ya operable mediante fórmulas (`IF`, `IFS`, `SWITCH` en la barra `fx`).
   - *Pendiente diferido:* Constructor visual tipo *Power Query Column Rule Builder* ("Si columna A contiene X entonces Y, de lo contrario Z") que emita el AST de fórmula automáticamente.
7. **Columna desde Ejemplos (Inferencia LLM / Flash Fill):**
   - *Estado actual:* Puente LLM listo (`buildLlmPromptForTable`).
   - *Pendiente diferido:* Columna fantasma interactiva donde el usuario teclea 2 ejemplos y el motor de IA de Analyticraft sintetiza la regla y la inyecta como paso verificado.
8. **Parámetros Dinámicos en Recetas (`.refine.json` v2):**
   - *Por qué se difiere:* Variables de entorno como `{{CARPETA_ENTRADA}}`, `{{AÑO}}` o `{{SUCURSAL}}` tienen valor real en tuberías de producción programadas (Batch ETL), las cuales correrán bajo el orquestador de Analyticraft.
