# Propuesta de Arquitectura: Módulo de Importación ("Obtener Datos / Get Data")

> **Documento de conceptualización técnica para ModernRefine y su integración en Analyticraft.**  
> Basado en la premisa: *"Hacer ahora lo suficiente para el 90% de los usuarios y conectar con elegancia hacia Analyticraft sin desviar el producto"*.

---

## 1. El Principio Fundamental: Importar es un Snapshot, No una Conexión Viva

En Power BI / Power Query tradicional, un conector suele plantearse como una tubería acoplada (*DirectQuery* o *Query Folding* frágil). En ModernRefine el principio es radicalmente distinto:

```
Fuente Externa (SQL / Web / Excel)
       │
       ▼ [1. Conectar + Credenciales en Keyring]
       │
       ▼ [2. Previsualizar primeras 100 filas]
       │
       ▼ [3. Importar como Snapshot inmutable en memoria]
Tabla Local en Sesión de ModernRefine
       │
       ▼ [4. Motor de Limpieza determinista]
Receta Reproducible (.refine.json)
       │
       ▼ [5. Ingesta a Analyticraft / DuckDB]
```

### ¿Por qué Snapshot y no Live Connection?
1. **Local-First y Cero Ansiedad:** La promesa de ModernRefine es que la limpieza es 100% reversible y determinista. Si el dato muta en el servidor SQL a mitad de la limpieza, el historial y los índices inmutables (`origIdx`) se corrompen.
2. **Reproducibilidad Pura:** La receta `.refine.json` registra la metadata de origen (ej. servidor, base, tabla/consulta SQL con `LIMIT 1000`), permitiendo re-ejecutar la extracción cuando el analista lo decida explícitamente, sin bloqueos de red en cada paso.
3. **Separación Real de Responsabilidades (ETL Clásico):** *Extract* (traer datos a tabla cruda) queda estrictamente separado de *Transform* (limpiar datos). El motor de limpieza no sabe ni necesita saber de dónde vinieron los bytes: solo recibe un `DataFrame / DataRow[]`.

---

## 2. Los 3 Conectores que Cubren el 90% del Trabajo Real

En lugar de construir 100 conectores frágiles, el 90% de las necesidades de oficina se cubren con 3 familias de entrada:

### Conector 1: Web REST API & JSON / CSV por URL
- **Caso de uso:** APIs de gobierno, datos abiertos, catálogos públicos y reportes JSON de ERPs modernos.
- **Mecánica:**
  - El usuario ingresa la URL (y opcionalmente headers/token Bearer).
  - El backend (Rust vía `reqwest`) hace un `GET`, auto-detecta si el cuerpo es un array plano o un objeto contenedor (`{ "data": [...] }`, `{ "results": [...] }`), extrae las columnas y monta una sesión con preview instantáneo.

### Conector 2: Tablas Wikipedia y Wikidata (Catálogos Limpios)
- **Caso de uso:** Enriquecer bases de clientes con padrones oficiales de municipios, códigos postales, estados, monedas o países sin tener que scrapear a mano.
- **Mecánica:**
  - *Opción A (Tablas HTML de Wikipedia):* El usuario pega la URL de un artículo (ej. *"Municipios de Tabasco"*); Rust parsea las etiquetas `<table>` y le permite al usuario elegir qué tabla montar en la sesión.
  - *Opción B (Wikidata SPARQL / Plantillas prefabricadas):* Selector con 1 clic para catálogos canónicos (ej. *"Catálogo de Estados de México"*, *"Códigos de Países ISO 3166"*).

### Conector 3: Bases de Datos SQL (SQL Server, PostgreSQL, MySQL)
- **Caso de uso:** Extracciones de ERP empresarial (SAP, Oracle, microsip, sistemas internos) donde el analista de BI hoy pide un `.csv` al departamento de TI porque Power BI le resulta demasiado pesado.
- **Mecánica:**
  - Diálogo de conexión: Servidor, Puerto, Base de datos, Usuario, Contraseña.
  - El motor lista las tablas y vistas disponibles.
  - El usuario elige la tabla (o teclea una consulta `SELECT`) y el motor ejecuta una extracción controlada con `LIMIT 1000` (o `TOP 1000`) para preview.
  - Al pulsar *Importar*, se carga la tabla a la sesión activa.

---

## 3. Experiencia de Usuario Familiar (Referencia Power BI Desktop)

Para que el analista proveniente de Excel o Power BI reconozca el flujo al instante sin curva de aprendizaje, la interfaz de **Obtener datos** adopta el patrón estándar en 4 pasos (respaldado por las capturas en `docs/screenshots/`):

1. **Menú rápido "Orígenes de datos comunes"** (`docs/screenshots/pbi_01_origenes_comunes.png`):
   - Desplegable desde el botón `Obtener datos ▾` en el Ribbon `Inicio` (y en el Backstage `Archivo`).
   - Lista directa de los conectores de uso diario (`Libro de Excel`, `Texto o CSV`, `JSON`, `Web`, `SQL Server / PostgreSQL / MySQL`, `Wikipedia`) + opción **`Más...`**.
2. **Catálogo "Obtener datos" de 2 paneles** (`docs/screenshots/pbi_02_modal_obtener_datos.png`):
   - **Izquierda:** Buscador instantáneo + categorías simplificadas (`Todo`, `Archivo`, `Base de datos`, `Web y Catálogos`).
   - **Derecha:** Lista de conectores con icono y nombre, filtrando ruido corporativo innecesario (sin Azure/Fabric/Netezza).
   - **Acción primaria:** Botón teal **`Conectar`** (`--mr-accent: #117865`, idéntico al lenguaje visual ya implementado en ModernRefine).
3. **Configuración de Origen (ej. SQL)** (`docs/screenshots/pbi_03_config_sql_server.png`):
   - Campos esenciales visibles: `Servidor` y `Base de datos (opcional)`.
   - **Modo de conectividad:** Radio **`Importar (Snapshot local)`** seleccionado por defecto; la opción `DirectQuery` se muestra bloqueada con nota *"Requiere integración con Analyticraft (DuckDB)"* para comunicar claramente el alcance.
   - **Acordeón colapsable `▸ Opciones avanzadas`:** `Tiempo de espera (seg)` e `Instrucción SQL (SELECT opcional)`.
4. **Autenticación con Nivel de Alcance** (`docs/screenshots/pbi_04_credenciales_windows.png`, `docs/screenshots/pbi_05_credenciales_bd_nivel.png`):
   - Barra lateral izquierda de métodos: `Windows` (autenticación integrada, cuando aplique) | `Base de datos` (`Usuario` + `Contraseña`) | *(para Web API)* `Anónimo` / `Bearer Token`.
   - Selector **"Nivel al que aplicar esta configuración"** (`servidor.dominio` vs `servidor.dominio;BaseDeDatos`), permitiendo reutilizar credenciales entre bases del mismo servidor.
   - Navegación estándar: **`Atrás`**, **`Conectar`**, **`Cancelar`**.
5. **Navegador y Vista Previa (100 filas):**
   - Si no se ingresó consulta SQL manual, lista las tablas/vistas a la izquierda y muestra 100 filas de muestra a la derecha antes de pulsar **`Importar a ModernRefine`**.

---

## 4. Arquitectura en Rust: El Trait `Source` (Cero Contaminación del Limpiador)

Para evitar acoplar la red con el motor de limpieza, en `modern_refine_engine` se define una abstracción desacoplada:

```rust
pub struct TableSchema {
    pub name: String,
    pub columns: Vec<String>,
}

pub struct SourcePreview {
    pub columns: Vec<String>,
    pub sample_rows: Vec<HashMap<String, String>>,
    pub total_estimated: Option<usize>,
}

pub trait DataSource: Send + Sync {
    fn id(&self) -> &str;
    fn display_name(&self) -> &str;
    fn list_tables(&self) -> Result<Vec<TableSchema>, String>;
    fn preview(&self, table_or_query: &str, limit: usize) -> Result<SourcePreview, String>;
    fn extract_snapshot(&self, table_or_query: &str) -> Result<(Vec<String>, Vec<HashMap<String, String>>), String>;
}
```

### Implementaciones específicas:
- `CsvSource` / `ExcelSource`: Ya funcionales hoy mediante `calamine` y parser CSV.
- `WebSource`: Rust (`reqwest` + `serde_json`).
- `SqlSource`: Rust (`sqlx` para PostgreSQL / MySQL / SQL Server compilado en Tauri).
- `WikipediaSource`: Rust (`scraper` HTML para tablas limpias).

Ningún conector ejecuta transformaciones; todos devuelven un conjunto plano de filas que se inyecta directamente a `openOrActivateSession(name, cols, rows, meta)` en el frontend.

---

## 5. Seguridad y Gestión de Credenciales

> [!CAUTION]
> **Regla de oro: Cero contraseñas en texto plano.**

1. **En las Recetas (`.refine.json`):**
   - La receta **NUNCA** guarda la contraseña del servidor SQL.
   - Solo guarda el descriptor de conexión:
     ```json
     "source": {
       "type": "sql_server",
       "server": "192.168.1.50",
       "database": "VentasCorp",
       "query": "SELECT id, cliente, monto, fecha FROM transacciones_2025"
     }
     ```
2. **En el Escritorio (Tauri):**
   - Las contraseñas de bases de datos se almacenan de forma segura en el llavero nativo del sistema operativo (Windows Credential Manager / macOS Keychain) mediante `keyring-rs`.
   - Si otra persona abre la receta en su equipo, la aplicación le solicitará autenticarse una sola vez en ese entorno.

---

## 6. Hoja de Ruta Gradual (Roadmap Pragmático)

| Fase | Conectores / Entregable | Dónde vive |
| :--- | :--- | :--- |
| **Fase A (Actual - v0.4)** | Excel (`.xlsx`, `.xls`, `.ods`), CSV/TSV, JSON local y plantillas en raíz. | ModernRefine Standalone |
| **Fase B (Siguiente iteración)** | **Importador Web JSON/CSV (URL)** + **Tablas Wikipedia**. Cero configuración de red empresarial. | ModernRefine Standalone |
| **Fase C (SQL Snapshot)** | Conexión SQL Server / PostgreSQL para importar tablas con preview de 100 filas y extracción a snapshot. | ModernRefine Standalone |
| **Fase D (Fusión con Analyticraft)** | Carpeta local (apilar múltiples archivos automáticamente), conector Google Sheets/SharePoint, almacenamiento analítico en DuckDB y refresh programado. | **Analyticraft Core** |
