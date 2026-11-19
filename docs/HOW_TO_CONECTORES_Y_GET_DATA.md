# Guía Técnica de Implementación (How-To): Módulo "Obtener Datos / Get Data"

> **Referencia:** [PROPUESTA_CONECTORES_SQL_Y_GET_DATA.md](PROPUESTA_CONECTORES_SQL_Y_GET_DATA.md)  
> **Objetivo:** Explicar las bases técnicas reales que ya existen en el proyecto y documentar el paso a paso (*How-To*) para implementar los conectores prioritarios (Web/JSON, Wikipedia y Bases SQL) sin romper el motor determinista ni la promesa *local-first*.

---

## 1. ¿Qué bases reales tenemos construidas hoy? (El punto de partida)

No empezamos desde cero. Ya tenemos el 70% de la fontanería requerida:

### A. La puerta de entrada universal ya existe: `openOrActivateSession`
En `src/App.tsx`, cualquier dato externo entra por una única función:
```typescript
openOrActivateSession(
  name: string,
  cols: string[],
  rows: DataRow[],
  meta: FileIngestionMeta,
  wb?: XLSX.WorkBook
)
```
- Acepta cualquier arreglo de filas plano `Record<string, string>[]`.
- Asigna los `origIdx` inmutables.
- Inicia el historial reproducible `.refine.json` en una pestaña aislada.
- **Conclusión:** Para el limpiador, un archivo `.csv` local, un `.xlsx`, una consulta SQL o una API Web se procesan **exactamente igual** una vez entregados.

### B. El Backend Rust con Tauri v2 y Rayon
- Ya tenemos el crate `modern_refine_engine` (`src-rust/`) y el contenedor de escritorio `src-tauri/`.
- Rust ya cuenta con `serde`, `serde_json`, `rayon` y un puente IPC rápido (`invoke`) funcionando (`refine_cluster`, `refine_profile_column`, `write_export_file`).
- La invocación nativa no sufre bloqueos de CORS del navegador (Tauri ejecuta solicitudes HTTP y conexiones de red directamente a nivel sistema operativo).

### C. Sistema Visual y Puntos de Anclaje Ya Preparados en la UI (`src/styles/tokens.css`, `src/App.tsx`, `src/App.css`)
- **Estética nativa idéntica al estándar Power BI / Fluent 2 Light:** En `src/styles/tokens.css`, el acento primario ya es `--mr-accent: #117865` (el mismo verde/teal corporativo de los botones `Conectar` y `Aceptar` de Power BI), sobre superficies `--mr-surface: #ffffff` y barras laterales `--mr-chrome: #f5f5f5`.
- **Anclajes listos en el shell actual (`src/App.tsx`):**
  - En el Ribbon `Inicio` (grupo `Integraciones`), ya existe el botón `Origen SQL` (`disabled`, icono `Database`) esperando ser conectado o ampliado a `Obtener datos ▾`.
  - En el Backstage `Archivo`, ya existe la entrada `Obtener datos` (`disabled`) lista para lanzar el catálogo.
- **Primitivas CSS reutilizables (`src/App.css`):** Ya contamos con `.mr-dropdown-menu`, `.mr-dialog-overlay`, `.mr-dialog` y el patrón de barra lateral oscura/neutra `.mr-backstage-nav` para construir el wizard de autenticación sin agregar librerías externas.

### D. La base DuckDB en el proyecto padre (`Analyticraft`)
- En el repositorio padre (`Analyticraft/src/lib/duckdb.ts`), ya existe la infraestructura para ejecutar consultas SQL analíticas sobre tablas en memoria.
- Cuando ModernRefine exporte datos limpios o requiera consultas locales complejas (o *DirectQuery* en el futuro), DuckDB ya está listo para recibir el snapshot.

---

## 2. Diagrama de Flujo del Módulo

```text
[ Usuario ]
    │
    ▼ Clic en "Obtener datos ▾" (Menú rápido estilo Power BI: pbi_01)
    ├── Excel / CSV / JSON ──> Selector de archivo local actual (ya operativo)
    └── "Más..." / Web / Wikipedia / SQL ──> [ Modal Catálogo 2 Columnas (pbi_02) ]
                                                    │
                                                    ▼ Clic en "Conectar"
                                          [ Modal Configuración de Fuente (pbi_03) ]
                                          (Servidor, Base, Modo: Importar, Opciones avanzadas SQL)
                                                    │
                                                    ▼ Clic en "Aceptar"
                                          [ Modal Credenciales por Nivel (pbi_04 / pbi_05) ]
                                          (Barra izq: Windows / Base de datos / Token · Nivel: servidor vs servidor;BD)
                                                    │
                                                    ▼ [Comando IPC Tauri -> Rust]
                                          [ Trait DataSource ] (reqwest / scraper / sqlx + keyring)
                                                    │
                                                    ▼ Retorna lista de tablas + Preview 100 filas
                                          [ Navegador de Tablas + Preview ]
                                                    │
                                                    ▼ Clic en "Cargar / Importar Snapshot"
                                          [ openOrActivateSession(...) -> Pestaña en ModernRefine ]
```

---

## 3. How-To Paso a Paso: Implementación Técnica

### Paso 1: Definir los tipos en TypeScript (`src/types/refine.ts`)

```typescript
export type SourceKind = "file" | "web_json" | "wikipedia" | "sql";
export type SqlDialect = "sqlserver" | "postgres" | "mysql";
export type AuthMethod = "windows" | "database" | "anonymous" | "bearer";

export interface SourceConnectionParams {
  kind: SourceKind;
  url?: string;
  headers?: Record<string, string>;
  sqlDialect?: SqlDialect;
  server?: string;
  port?: number;
  database?: string;
  timeoutSeconds?: number;
  customSqlQuery?: string; // Equivalente a "Instrucción SQL (opcional)"
  tableOrQuery?: string;
  auth?: {
    method: AuthMethod;
    username?: string;
    password?: string; // Solo en memoria durante el invoke; se guarda en Keyring OS, jamás en .refine.json
    scopeLevel?: string; // Ej. "servidor.net" o "servidor.net;BaseDatos"
  };
}

export interface SourcePreviewData {
  columns: string[];
  sampleRows: DataRow[];
  totalEstimatedRows?: number;
}
```

---

### Paso 2: Crear el Trait y los Conectores en Rust (`src-rust/src/sources.rs`)

En `src-rust/Cargo.toml` añadimos las dependencias necesarias:
```toml
[dependencies]
reqwest = { version = "0.12", features = ["json", "blocking"] }
# Para SQL ligero o conexiones nativas
# sqlx = { version = "0.8", default-features = false, features = ["runtime-tokio", "postgres", "mysql"] }
```

Definimos la interfaz en Rust:
```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize, Deserialize)]
pub struct SourcePreview {
    pub columns: Vec<String>,
    pub sample_rows: Vec<HashMap<String, String>>,
}

pub trait DataSource {
    fn preview(&self, limit: usize) -> Result<SourcePreview, String>;
    fn extract_all(&self) -> Result<(Vec<String>, Vec<HashMap<String, String>>), String>;
}
```

#### Implementación A: Web JSON (`WebSource`)
```rust
pub struct WebJsonSource {
    pub url: String,
}

impl DataSource for WebJsonSource {
    fn preview(&self, limit: usize) -> Result<SourcePreview, String> {
        let resp: serde_json::Value = reqwest::blocking::get(&self.url)
            .map_err(|e| e.to_string())?
            .json()
            .map_err(|e| e.to_string())?;

        // Si es array plano: [ { a: 1 }, { a: 2 } ]
        // Si es objeto con data: { "data": [ ... ] }
        let rows_val = if let Some(arr) = resp.as_array() {
            arr
        } else if let Some(arr) = resp.get("data").and_then(|v| v.as_array()) {
            arr
        } else if let Some(arr) = resp.get("results").and_then(|v| v.as_array()) {
            arr
        } else {
            return Err("El JSON no contiene un arreglo de registros tabular".into());
        };

        let mut columns = Vec::new();
        let mut sample_rows = Vec::new();

        for (idx, item) in rows_val.iter().enumerate() {
            if idx >= limit { break; }
            if let Some(obj) = item.as_object() {
                let mut row = HashMap::new();
                for (k, v) in obj {
                    if idx == 0 { columns.push(k.clone()); }
                    row.insert(k.clone(), v.as_str().map(|s| s.to_string()).unwrap_or_else(|| v.to_string()));
                }
                sample_rows.push(row);
            }
        }
        Ok(SourcePreview { columns, sample_rows })
    }

    fn extract_all(&self) -> Result<(Vec<String>, Vec<HashMap<String, String>>), String> {
        // Idéntico a preview pero sin corte de límite
        // ...
    }
}
```

---

### Paso 3: Exponer los comandos en Tauri (`src-tauri/src/lib.rs`)

```rust
#[tauri::command]
fn preview_external_source(params: SourceConnectionParams) -> Result<SourcePreview, String> {
    match params.kind.as_str() {
        "web_json" => {
            let src = WebJsonSource { url: params.url.unwrap_or_default() };
            src.preview(100)
        },
        // SQL, Wikipedia...
        _ => Err("Tipo de fuente no soportado".into()),
    }
}

#[tauri::command]
fn fetch_external_snapshot(params: SourceConnectionParams) -> Result<(Vec<String>, Vec<HashMap<String, String>>), String> {
    // Extrae y devuelve la matriz completa para montar la pestaña
}
```

---

### Paso 4: Diseñar el Wizard de Importación Familiar en React (`src/components/GetDataWizard.tsx`)

Alineado directamente con las 5 capturas de referencia de Power BI (`docs/screenshots/pbi_01_*.png` a `pbi_05_*.png`) y usando nuestras clases `.mr-dialog`, `.mr-dropdown-menu` y el acento `--mr-accent (#117865)`:

1. **Menú rápido "Orígenes de datos comunes"** (`pbi_01_origenes_comunes.png`):
   - Desplegable desde el botón `Obtener datos ▾` en el Ribbon `Inicio` (reemplazando al botón deshabilitado `Origen SQL`).
   - Accesos directos: `Libro de Excel`, `Texto o CSV`, `JSON`, `Web`, `SQL Server / PostgreSQL / MySQL`, `Wikipedia / Wikidata`, y al pie **`Más...`**.
2. **Paso A — Catálogo "Obtener datos" de 2 paneles** (`pbi_02_modal_obtener_datos.png`):
   - **Izquierda:** Input de búsqueda + filtros de categoría (`Todo`, `Archivo`, `Base de datos`, `Web y Catálogos`).
   - **Derecha:** Lista limpia de conectores con icono.
   - **Footer:** Botón primario teal `Conectar` y `Cancelar`.
3. **Paso B — Configuración del Conector** (`pbi_03_config_sql_server.png`):
   - Para **SQL:** `Servidor`, `Base de datos (opcional)`, selector de conectividad (`Importar (Snapshot)` activo; `DirectQuery (En Analyticraft)` deshabilitado con tooltip informativo) y acordeón **`▸ Opciones avanzadas`** (`Tiempo de espera en segundos`, textarea `Instrucción SQL (opcional)`).
   - Para **Web / Wikipedia:** Input de `URL` y selector de encabezados / tabla HTML.
4. **Paso C — Credenciales con Barra Lateral y Nivel** (`pbi_04_credenciales_windows.png`, `pbi_05_credenciales_bd_nivel.png`):
   - **Barra lateral izquierda oscura (`#2b2b2b` / `#1f1f1f`):** Tabs verticales según tipo de conector (`Windows` / `Base de datos` para SQL; `Anónimo` / `Token API` para Web).
   - **Header contextual:** Muestra el destino (`servidor.dominio;BaseDeDatos`).
   - **Selector "Aplicar configuración en nivel":** Dropdown con `[servidor]` (global para todas las bases de ese host) y `[servidor;BaseDeDatos]` (específico). La clave resultante se usa como `service/account` en el **Keyring nativo** del sistema operativo.
   - **Footer:** `Atrás`, `Conectar`, `Cancelar`.
5. **Paso D — Navegador y Vista Previa (100 filas):**
   - Muestra las tablas/vistas disponibles a la izquierda y una tabla de previsualización de 100 filas a la derecha.
   - Al confirmar **"Cargar / Importar"**, invoca `openOrActivateSession(nombreTabla, cols, rows, meta)` y cierra el asistente.

---

### Paso 5: Persistencia en la Receta (`.refine.json`)

Para que la receta siga siendo reproducible sin comprometer contraseñas:
```json
{
  "schema": "modern-refine/v2",
  "tableName": "clientes_erp",
  "source": {
    "type": "sql_server",
    "server": "sql.miempresa.com",
    "database": "Ventas",
    "table": "Clientes_Activos"
  },
  "steps": [
    { "kind": "trim", "column": "Nombre" },
    { "kind": "remove_duplicates", "column": "RFC" }
  ]
}
```
*Si se carga la receta en otra máquina, la app pregunta la contraseña localmente o la busca en el Keyring del sistema, pero el archivo `.refine.json` se puede compartir con seguridad en Git.*

---

## 4. Criterio de Éxito (Definition of Done)

1. **Autonomía:** El usuario puede pegar una URL de un JSON público (ej. API de clima, gobierno o GitHub) y tener la tabla montada en 2 clics.
2. **Sin bloqueos CORS:** Funciona en escritorio nativo (Tauri) sin errores de origen cruzado de navegador.
3. **Aislamiento Total:** El motor de clustering, facetas y limpieza no sufre cambios; sigue operando sobre filas en memoria de manera determinista.
