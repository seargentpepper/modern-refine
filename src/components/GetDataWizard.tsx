import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Database,
  FileJson,
  FileSpreadsheet,
  FileText,
  Globe,
  BookOpen,
  Lock,
  Search,
  Server,
  X,
} from "lucide-react";
import {
  fetchExternalSnapshotBridge,
  previewExternalSourceBridge,
} from "../lib/tauriBridge";
import {
  loadScopedCredentialMemory,
  sanitizeSourceDescriptor,
  saveScopedCredentialMemory,
} from "../lib/sourceParsers";
import type {
  AuthMethod,
  SourceConnectionParams,
  SourceDescriptor,
  SourceKind,
  SourcePreviewData,
  SourceSnapshotData,
  SqlDialect,
} from "../types/refine";

export type GetDataInitialTarget =
  | "catalog"
  | "web_json"
  | "wikipedia"
  | "sqlserver"
  | "postgres"
  | "mysql";

interface ConnectorDef {
  id: "excel" | "csv" | "json" | "sqlserver" | "postgres" | "mysql" | "web_json" | "wikipedia";
  name: string;
  category: "Archivo" | "Base de datos" | "Web y Catálogos";
  kind: SourceKind;
  sqlDialect?: SqlDialect;
  subtitle: string;
}

const CONNECTORS: ConnectorDef[] = [
  {
    id: "excel",
    name: "Libro de Excel (.xlsx / .xls / .ods)",
    category: "Archivo",
    kind: "file",
    subtitle: "Importar hojas de cálculo locales con selector de pestaña",
  },
  {
    id: "csv",
    name: "Texto o CSV / TSV",
    category: "Archivo",
    kind: "file",
    subtitle: "Auto-detección de delimitador (, ; tab |)",
  },
  {
    id: "json",
    name: "JSON local",
    category: "Archivo",
    kind: "file",
    subtitle: "Arreglos JSON o estructuras tabulares locales",
  },
  {
    id: "sqlserver",
    name: "Base de datos SQL Server",
    category: "Base de datos",
    kind: "sql",
    sqlDialect: "sqlserver",
    subtitle: "Snapshot SQL Server (TOP 1000 / consulta SELECT)",
  },
  {
    id: "postgres",
    name: "Base de datos PostgreSQL",
    category: "Base de datos",
    kind: "sql",
    sqlDialect: "postgres",
    subtitle: "Snapshot PostgreSQL (LIMIT / consulta SELECT)",
  },
  {
    id: "mysql",
    name: "Base de datos MySQL",
    category: "Base de datos",
    kind: "sql",
    sqlDialect: "mysql",
    subtitle: "Snapshot MySQL / MariaDB",
  },
  {
    id: "web_json",
    name: "Web (API REST JSON / CSV)",
    category: "Web y Catálogos",
    kind: "web_json",
    subtitle: "Importar datos públicos o privados desde una URL HTTP/HTTPS",
  },
  {
    id: "wikipedia",
    name: "Tablas de Wikipedia",
    category: "Web y Catálogos",
    kind: "wikipedia",
    subtitle: "Extrae tablas HTML limpias de artículos de Wikipedia",
  },
];

function ConnectorIcon({ id }: { id: ConnectorDef["id"] }) {
  switch (id) {
    case "excel":
      return <FileSpreadsheet size={16} style={{ color: "#107c41" }} />;
    case "csv":
      return <FileText size={16} style={{ color: "#5c6b73" }} />;
    case "json":
      return <FileJson size={16} style={{ color: "#ca5010" }} />;
    case "sqlserver":
    case "postgres":
    case "mysql":
      return <Database size={16} style={{ color: "#b45309" }} />;
    case "web_json":
      return <Globe size={16} style={{ color: "#0066cc" }} />;
    case "wikipedia":
      return <BookOpen size={16} style={{ color: "#117865" }} />;
  }
}

interface GetDataWizardProps {
  initialTarget: GetDataInitialTarget | null;
  onClose: () => void;
  onTriggerLocalFilePicker: (acceptFilter?: string) => void;
  onImportSnapshot: (snapshot: SourceSnapshotData, descriptor: SourceDescriptor) => void;
}

export function GetDataWizard({
  initialTarget,
  onClose,
  onTriggerLocalFilePicker,
  onImportSnapshot,
}: GetDataWizardProps) {
  const resolveInitialConnector = (): ConnectorDef => {
    if (initialTarget && initialTarget !== "catalog") {
      return CONNECTORS.find((c) => c.id === initialTarget) ?? CONNECTORS[3];
    }
    return CONNECTORS[0];
  };

  const [selectedConnector, setSelectedConnector] = useState<ConnectorDef>(resolveInitialConnector);
  const [stage, setStage] = useState<"catalog" | "config" | "auth" | "navigator">(
    initialTarget && initialTarget !== "catalog" ? "config" : "catalog"
  );

  // Catalog filter
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<
    "Todo" | "Archivo" | "Base de datos" | "Web y Catálogos"
  >("Todo");

  // Config params
  const [urlInput, setUrlInput] = useState("");
  const [serverInput, setServerInput] = useState("");
  const [databaseInput, setDatabaseInput] = useState("");
  const [showAdvancedSql, setShowAdvancedSql] = useState(false);
  const [timeoutSeconds, setTimeoutSeconds] = useState("30");
  const [customSqlQuery, setCustomSqlQuery] = useState("");
  const [tableInput, setTableInput] = useState("");

  // Auth params (PBI screens 4 & 5)
  const [authMethod, setAuthMethod] = useState<AuthMethod>(
    selectedConnector.kind === "sql" ? "database" : "anonymous"
  );
  const [useCurrentWindowsCreds, setUseCurrentWindowsCreds] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [scopeLevel, setScopeLevel] = useState("");

  // Preview / Navigator state
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<SourcePreviewData | null>(null);
  const [selectedTableIndex, setSelectedTableIndex] = useState(0);

  const filteredConnectors = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return CONNECTORS.filter((c) => {
      if (categoryFilter !== "Todo" && c.category !== categoryFilter) return false;
      if (q && !c.name.toLowerCase().includes(q) && !c.subtitle.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [searchQuery, categoryFilter]);

  const scopeOptions = useMemo(() => {
    if (selectedConnector.kind === "sql") {
      const host = serverInput.trim() || "servidor-sql";
      const db = databaseInput.trim();
      return db ? [host, `${host};${db}`] : [host];
    }
    const cleanUrl = urlInput.trim();
    try {
      const u = new URL(cleanUrl);
      return [u.origin, `${u.origin}${u.pathname}`];
    } catch {
      return [cleanUrl || "origen-web"];
    }
  }, [selectedConnector.kind, serverInput, databaseInput, urlInput]);

  const effectiveScopeLevel = scopeOptions.includes(scopeLevel)
    ? scopeLevel
    : scopeOptions[0] ?? "";

  const buildParams = (tableIdxOverride?: number): SourceConnectionParams => ({
    kind: selectedConnector.kind,
    url: urlInput.trim() || undefined,
    sqlDialect: selectedConnector.sqlDialect,
    server: serverInput.trim() || undefined,
    database: databaseInput.trim() || undefined,
    timeoutSeconds: Number(timeoutSeconds) > 0 ? Number(timeoutSeconds) : undefined,
    customSqlQuery: customSqlQuery.trim() || undefined,
    tableOrQuery: tableInput.trim() || undefined,
    tableIndex: tableIdxOverride ?? selectedTableIndex,
    auth: {
      method: authMethod,
      useCurrentWindowsCreds,
      username: username.trim() || undefined,
      password: password || undefined,
      scopeLevel: effectiveScopeLevel || undefined,
    },
  });

  const handleOpenConfigForConnector = (conn: ConnectorDef) => {
    setErrorMsg(null);
    if (conn.kind === "file") {
      const acceptMap: Record<string, string> = {
        excel: ".xlsx,.xls,.ods",
        csv: ".csv,.tsv,.txt",
        json: ".json",
      };
      onTriggerLocalFilePicker(acceptMap[conn.id]);
      onClose();
      return;
    }
    setSelectedConnector(conn);
    setAuthMethod(conn.kind === "sql" ? "database" : "anonymous");
    setStage("config");
  };

  const handleMoveToAuthOrConnect = () => {
    setErrorMsg(null);
    if (selectedConnector.kind === "wikipedia") {
      if (!urlInput.trim()) {
        setErrorMsg("Ingresa un artículo o URL de Wikipedia.");
        return;
      }
      void runPreview(0);
      return;
    }
    if (selectedConnector.kind === "web_json" && !urlInput.trim()) {
      setErrorMsg("Ingresa la dirección URL de la fuente Web.");
      return;
    }
    if (selectedConnector.kind === "sql" && !serverInput.trim()) {
      setErrorMsg("Especifica el servidor SQL para continuar.");
      return;
    }

    const defaultScope = scopeOptions[0] ?? "";
    setScopeLevel(defaultScope);
    const cached = loadScopedCredentialMemory(defaultScope);
    if (cached) {
      setUsername(cached.username);
      setPassword(cached.password);
    }
    setStage("auth");
  };

  const runPreview = async (tableIdx = 0) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      if (effectiveScopeLevel && (username.trim() || password)) {
        saveScopedCredentialMemory(effectiveScopeLevel, username.trim(), password);
      }
      const data = await previewExternalSourceBridge(buildParams(tableIdx));
      setPreviewData(data);
      setSelectedTableIndex(tableIdx);
      setStage("navigator");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleFinalImport = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const params = buildParams(selectedTableIndex);
      const snapshot = await fetchExternalSnapshotBridge(params);
      const descriptor = sanitizeSourceDescriptor(params, snapshot.sourceName);
      onImportSnapshot(snapshot, descriptor);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  if (!initialTarget) return null;

  return (
    <div className="mr-dialog-overlay" onClick={onClose}>
      <div
        className={`mr-dialog mr-getdata-dialog ${stage === "navigator" ? "wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mr-dialog-header">
          <span>
            {stage === "catalog" && "Obtener datos"}
            {stage === "config" && selectedConnector.name}
            {stage === "auth" && selectedConnector.name}
            {stage === "navigator" && `Navegador — ${previewData?.sourceName || selectedConnector.name}`}
          </span>
          <button className="mr-pane-collapse-btn" onClick={onClose} title="Cerrar (Esc)">
            <X size={16} />
          </button>
        </div>

        {/* STAGE 1: CATÁLOGO 2 COLUMNAS (pbi_02_modal_obtener_datos.png) */}
        {stage === "catalog" && (
          <>
            <div className="mr-getdata-catalog">
              <aside className="mr-getdata-cats">
                <div className="mr-getdata-search-wrap">
                  <Search size={13} />
                  <input
                    className="mr-cell-input"
                    autoFocus
                    placeholder="Buscar conector..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                {(["Todo", "Archivo", "Base de datos", "Web y Catálogos"] as const).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    className={`mr-getdata-cat-btn ${categoryFilter === cat ? "active" : ""}`}
                    onClick={() => setCategoryFilter(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </aside>

              <div className="mr-getdata-list">
                <div className="mr-getdata-list-title">{categoryFilter}</div>
                {filteredConnectors.length === 0 ? (
                  <div className="mr-subfacet-empty">No se encontraron conectores para "{searchQuery}".</div>
                ) : (
                  filteredConnectors.map((conn) => (
                    <button
                      key={conn.id}
                      type="button"
                      className={`mr-getdata-item ${selectedConnector.id === conn.id ? "selected" : ""}`}
                      onClick={() => setSelectedConnector(conn)}
                      onDoubleClick={() => handleOpenConfigForConnector(conn)}
                    >
                      <span className="mr-getdata-item-icon">
                        <ConnectorIcon id={conn.id} />
                      </span>
                      <span className="mr-getdata-item-text">
                        <span className="mr-getdata-item-name">{conn.name}</span>
                        <span className="mr-getdata-item-sub">{conn.subtitle}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="mr-dialog-footer">
              <button
                type="button"
                className="mr-btn mr-btn-primary"
                onClick={() => handleOpenConfigForConnector(selectedConnector)}
              >
                Conectar
              </button>
              <button type="button" className="mr-btn" onClick={onClose}>
                Cancelar
              </button>
            </div>
          </>
        )}

        {/* STAGE 2: CONFIGURACIÓN DEL CONECTOR (pbi_03_config_sql_server.png) */}
        {stage === "config" && (
          <>
            <div className="mr-dialog-body">
              {selectedConnector.kind === "sql" && (
                <div className="mr-modal-stack">
                  <div className="mr-modal-field">
                    <label>Servidor</label>
                    <input
                      className="mr-cell-input"
                      autoFocus
                      value={serverInput}
                      onChange={(e) => setServerInput(e.target.value)}
                      placeholder="ej. localhost:1433 o sqlserver.miempresa.net"
                    />
                  </div>
                  <div className="mr-modal-field">
                    <label>Base de datos (opcional)</label>
                    <input
                      className="mr-cell-input"
                      value={databaseInput}
                      onChange={(e) => setDatabaseInput(e.target.value)}
                      placeholder="ej. VentasCorp"
                    />
                  </div>

                  <div className="mr-modal-field">
                    <label>Modo Conectividad de datos</label>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <label className="mr-modal-check">
                        <input type="radio" name="connMode" checked readOnly />
                        <span>
                          <strong>Importar</strong> (Snapshot local reproducible en ModernRefine)
                        </span>
                      </label>
                      <label
                        className="mr-modal-check"
                        style={{ opacity: 0.55, cursor: "not-allowed" }}
                        title="DirectQuery en vivo estará disponible cuando ModernRefine se integre con el motor OLAP de Analyticraft."
                      >
                        <input type="radio" name="connMode" disabled />
                        <span>DirectQuery (Disponible en integración con Analyticraft)</span>
                      </label>
                    </div>
                  </div>

                  <div>
                    <button
                      type="button"
                      className="mr-advanced-toggle"
                      onClick={() => setShowAdvancedSql((v) => !v)}
                    >
                      {showAdvancedSql ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      <span>Opciones avanzadas</span>
                    </button>
                    {showAdvancedSql && (
                      <div className="mr-modal-stack" style={{ marginTop: 8 }}>
                        <div className="mr-modal-field">
                          <label>Tiempo de espera del comando en segundos (opcional)</label>
                          <input
                            type="number"
                            className="mr-cell-input"
                            style={{ width: 160 }}
                            value={timeoutSeconds}
                            onChange={(e) => setTimeoutSeconds(e.target.value)}
                          />
                        </div>
                        <div className="mr-modal-field">
                          <label>Tabla / Vista objetivo (si no usas SQL manual)</label>
                          <input
                            className="mr-cell-input"
                            value={tableInput}
                            onChange={(e) => setTableInput(e.target.value)}
                            placeholder="ej. dbo.Clientes"
                          />
                        </div>
                        <div className="mr-modal-field">
                          <label>Instrucción SQL (opcional, solo lectura SELECT)</label>
                          <textarea
                            className="mr-sql-textarea"
                            rows={4}
                            value={customSqlQuery}
                            onChange={(e) => setCustomSqlQuery(e.target.value)}
                            placeholder="SELECT TOP 1000 id, cliente, monto FROM dbo.Ventas"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {selectedConnector.kind === "web_json" && (
                <div className="mr-modal-stack">
                  <div className="mr-modal-field">
                    <label>Dirección URL (JSON array, API REST o CSV público)</label>
                    <input
                      className="mr-cell-input"
                      autoFocus
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      placeholder="https://jsonplaceholder.typicode.com/users"
                    />
                  </div>
                  <div className="mr-preset-row">
                    <span>Ejemplos rápidos:</span>
                    <button
                      type="button"
                      className="mr-pick-btn"
                      onClick={() => setUrlInput("https://jsonplaceholder.typicode.com/users")}
                    >
                      API Usuarios (JSON)
                    </button>
                    <button
                      type="button"
                      className="mr-pick-btn"
                      onClick={() =>
                        setUrlInput(
                          "https://raw.githubusercontent.com/datasets/country-codes/master/data/country-codes.csv"
                        )
                      }
                    >
                      Códigos de Países (CSV)
                    </button>
                  </div>
                </div>
              )}

              {selectedConnector.kind === "wikipedia" && (
                <div className="mr-modal-stack">
                  <div className="mr-modal-field">
                    <label>Artículo o URL de Wikipedia</label>
                    <input
                      className="mr-cell-input"
                      autoFocus
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      placeholder="ej. Anexo:Municipios de Tabasco o https://es.wikipedia.org/wiki/..."
                    />
                  </div>
                  <div className="mr-preset-row">
                    <span>Ejemplos rápidos:</span>
                    <button
                      type="button"
                      className="mr-pick-btn"
                      onClick={() => setUrlInput("Anexo:Municipios de Tabasco")}
                    >
                      Municipios de Tabasco
                    </button>
                    <button
                      type="button"
                      className="mr-pick-btn"
                      onClick={() =>
                        setUrlInput("Anexo:Entidades federativas de México por población")
                      }
                    >
                      Estados de México
                    </button>
                  </div>
                </div>
              )}

              {errorMsg && <div className="mr-formula-error" style={{ marginTop: 10 }}>⚠ {errorMsg}</div>}
            </div>

            <div className="mr-dialog-footer">
              <button
                type="button"
                className="mr-btn"
                onClick={() => {
                  setErrorMsg(null);
                  setStage("catalog");
                }}
              >
                Atrás
              </button>
              <button
                type="button"
                className="mr-btn mr-btn-primary"
                disabled={loading}
                onClick={handleMoveToAuthOrConnect}
              >
                {loading
                  ? "Conectando..."
                  : selectedConnector.kind === "wikipedia"
                    ? "Conectar y Previsualizar"
                    : "Aceptar"}
              </button>
              <button type="button" className="mr-btn" onClick={onClose}>
                Cancelar
              </button>
            </div>
          </>
        )}

        {/* STAGE 3: CREDENCIALES CON BARRA LATERAL Y NIVEL (pbi_04 y pbi_05) */}
        {stage === "auth" && (
          <>
            <div className="mr-auth-layout">
              <aside className="mr-auth-sidebar">
                {selectedConnector.kind === "sql" ? (
                  <>
                    <button
                      type="button"
                      className={`mr-auth-tab ${authMethod === "windows" ? "active" : ""}`}
                      onClick={() => setAuthMethod("windows")}
                    >
                      Windows
                    </button>
                    <button
                      type="button"
                      className={`mr-auth-tab ${authMethod === "database" ? "active" : ""}`}
                      onClick={() => setAuthMethod("database")}
                    >
                      Base de datos
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className={`mr-auth-tab ${authMethod === "anonymous" ? "active" : ""}`}
                      onClick={() => setAuthMethod("anonymous")}
                    >
                      Anónimo
                    </button>
                    <button
                      type="button"
                      className={`mr-auth-tab ${authMethod === "bearer" ? "active" : ""}`}
                      onClick={() => setAuthMethod("bearer")}
                    >
                      Token / API Key
                    </button>
                  </>
                )}
              </aside>

              <div className="mr-auth-body">
                <div className="mr-auth-target">
                  <Server size={15} style={{ color: "#b45309", flexShrink: 0 }} />
                  <span title={scopeOptions[scopeOptions.length - 1]}>
                    {scopeOptions[scopeOptions.length - 1]}
                  </span>
                </div>

                {authMethod === "windows" && (
                  <div className="mr-modal-stack">
                    <span style={{ fontSize: 12, color: "var(--mr-text-secondary)" }}>
                      Use sus credenciales de Windows para obtener acceso a esta base de datos.
                    </span>
                    <label className="mr-modal-check">
                      <input
                        type="radio"
                        checked={useCurrentWindowsCreds}
                        onChange={() => setUseCurrentWindowsCreds(true)}
                      />
                      Usar mis credenciales actuales
                    </label>
                    <label className="mr-modal-check">
                      <input
                        type="radio"
                        checked={!useCurrentWindowsCreds}
                        onChange={() => setUseCurrentWindowsCreds(false)}
                      />
                      Usar credenciales alternativas
                    </label>
                    {!useCurrentWindowsCreds && (
                      <>
                        <div className="mr-modal-field">
                          <label>Nombre de usuario</label>
                          <input
                            className="mr-cell-input"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                          />
                        </div>
                        <div className="mr-modal-field">
                          <label>Contraseña</label>
                          <input
                            type="password"
                            className="mr-cell-input"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}

                {authMethod === "database" && (
                  <div className="mr-modal-stack">
                    <div className="mr-modal-field">
                      <label>Nombre de usuario</label>
                      <input
                        className="mr-cell-input"
                        autoFocus
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="ej. analista_lectura"
                      />
                    </div>
                    <div className="mr-modal-field">
                      <label>Contraseña</label>
                      <input
                        type="password"
                        className="mr-cell-input"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                {authMethod === "anonymous" && (
                  <div style={{ fontSize: 12, color: "var(--mr-text-secondary)", lineHeight: 1.5 }}>
                    Se conectará de forma anónima sin enviar encabezados de autenticación. Ideal para
                    APIs públicas y datos abiertos.
                  </div>
                )}

                {authMethod === "bearer" && (
                  <div className="mr-modal-field">
                    <label>Bearer Token / API Key</label>
                    <input
                      type="password"
                      className="mr-cell-input"
                      autoFocus
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Pegar token privado..."
                    />
                  </div>
                )}

                <div className="mr-modal-field" style={{ marginTop: 12 }}>
                  <label>Seleccionar en qué nivel hay que aplicar esta configuración</label>
                  <select
                    className="mr-date-select"
                    value={effectiveScopeLevel}
                    onChange={(e) => {
                      const nextScope = e.target.value;
                      setScopeLevel(nextScope);
                      const cached = loadScopedCredentialMemory(nextScope);
                      if (cached) {
                        setUsername(cached.username);
                        setPassword(cached.password);
                      }
                    }}
                  >
                    {scopeOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mr-auth-security-note">
                  <Lock size={12} />
                  <span>Las credenciales nunca se guardan en texto plano dentro de `.refine.json`.</span>
                </div>

                {errorMsg && (
                  <div className="mr-formula-error" style={{ marginTop: 10 }}>
                    ⚠ {errorMsg}
                  </div>
                )}
              </div>
            </div>

            <div className="mr-dialog-footer">
              <button
                type="button"
                className="mr-btn"
                onClick={() => {
                  setErrorMsg(null);
                  setStage("config");
                }}
              >
                Atrás
              </button>
              <button
                type="button"
                className="mr-btn mr-btn-primary"
                disabled={loading}
                onClick={() => void runPreview(0)}
              >
                {loading ? "Conectando..." : "Conectar"}
              </button>
              <button type="button" className="mr-btn" onClick={onClose}>
                Cancelar
              </button>
            </div>
          </>
        )}

        {/* STAGE 4: NAVEGADOR DE TABLAS Y PREVIEW 100 FILAS */}
        {stage === "navigator" && previewData && (
          <>
            <div className="mr-navigator-layout">
              <aside className="mr-navigator-tables">
                <div className="mr-getdata-list-title">
                  Tablas detectadas ({previewData.tables.length})
                </div>
                {previewData.tables.map((tbl, idx) => (
                  <button
                    key={`${tbl.name}_${idx}`}
                    type="button"
                    className={`mr-getdata-item ${selectedTableIndex === idx ? "selected" : ""}`}
                    onClick={() => void runPreview(idx)}
                  >
                    <Database size={14} style={{ color: "var(--mr-accent)", flexShrink: 0 }} />
                    <div className="mr-getdata-item-text">
                      <span className="mr-getdata-item-name">{tbl.name}</span>
                      <span className="mr-getdata-item-sub">
                        {tbl.columns.length} cols
                        {tbl.rowCountHint !== undefined ? ` · ${tbl.rowCountHint} filas` : ""}
                      </span>
                    </div>
                  </button>
                ))}
              </aside>

              <div className="mr-navigator-preview">
                <div className="mr-navigator-preview-meta">
                  <span>
                    Vista previa: <strong>{previewData.sampleRows.length}</strong> de{" "}
                    <strong>{previewData.totalEstimatedRows ?? previewData.sampleRows.length}</strong>{" "}
                    filas ({previewData.columns.length} columnas)
                  </span>
                </div>
                <div className="mr-navigator-table-wrap">
                  <table className="mr-table">
                    <thead>
                      <tr>
                        {previewData.columns.map((c) => (
                          <th key={c}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.sampleRows.slice(0, 100).map((row, rIdx) => (
                        <tr key={rIdx}>
                          {previewData.columns.map((c) => (
                            <td key={c}>{row[c] || ""}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {errorMsg && <div className="mr-formula-error">⚠ {errorMsg}</div>}
              </div>
            </div>

            <div className="mr-dialog-footer">
              <button
                type="button"
                className="mr-btn"
                onClick={() =>
                  setStage(selectedConnector.kind === "wikipedia" ? "config" : "auth")
                }
              >
                Atrás
              </button>
              <button
                type="button"
                className="mr-btn mr-btn-primary"
                disabled={loading}
                onClick={() => void handleFinalImport()}
              >
                {loading ? "Importando snapshot..." : "Cargar en ModernRefine"}
              </button>
              <button type="button" className="mr-btn" onClick={onClose}>
                Cancelar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
