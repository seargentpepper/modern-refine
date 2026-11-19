import {
  extractCleanNumber,
  padMexicanPostalCode,
  parseCalendarDate,
  standardizeDateValue,
  toTitleCase,
} from "../refineEngine";

export type FormulaCategory = "texto" | "logica" | "numeros" | "fechas" | "mexico";

export interface FormulaFunctionDef {
  name: string;
  description: string;
  category: FormulaCategory;
  minArgs: number;
  maxArgs: number;
  examples: string[];
  implementation: (...args: unknown[]) => unknown;
}

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const isBlankVal = (v: unknown): boolean => str(v).trim() === "";
const num = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const cleaned = str(v).trim().replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  return cleaned !== "" && Number.isFinite(n) ? n : 0;
};
const removeAccents = (s: string): string => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const FUNCTIONS: FormulaFunctionDef[] = [
  // ======================== TEXTO (16) ========================
  {
    name: "TRIM",
    description: "Quita espacios al inicio y al final",
    category: "texto",
    minArgs: 1,
    maxArgs: 1,
    examples: ["TRIM([Nombre_Cliente])"],
    implementation: (v) => str(v).trim(),
  },
  {
    name: "UPPER",
    description: "Convierte todo el texto a MAYÚSCULAS",
    category: "texto",
    minArgs: 1,
    maxArgs: 1,
    examples: ["UPPER([Ciudad])"],
    implementation: (v) => str(v).toUpperCase(),
  },
  {
    name: "LOWER",
    description: "Convierte todo el texto a minúsculas",
    category: "texto",
    minArgs: 1,
    maxArgs: 1,
    examples: ["LOWER([Ciudad])"],
    implementation: (v) => str(v).toLowerCase(),
  },
  {
    name: "PROPER",
    description: "Convierte a Tipo Título (Primera Letra En Mayúscula)",
    category: "texto",
    minArgs: 1,
    maxArgs: 1,
    examples: ["PROPER([Nombre_Cliente])"],
    implementation: (v) => toTitleCase(str(v)),
  },
  {
    name: "LEN",
    description: "Devuelve la cantidad de caracteres del texto",
    category: "texto",
    minArgs: 1,
    maxArgs: 1,
    examples: ["LEN([Codigo_Postal])"],
    implementation: (v) => str(v).length,
  },
  {
    name: "LEFT",
    description: "Toma los primeros N caracteres desde la izquierda",
    category: "texto",
    minArgs: 2,
    maxArgs: 2,
    examples: ["LEFT([Nombre_Cliente], 5)"],
    implementation: (v, n) => str(v).slice(0, Math.max(0, Math.floor(num(n)))),
  },
  {
    name: "RIGHT",
    description: "Toma los últimos N caracteres desde la derecha",
    category: "texto",
    minArgs: 2,
    maxArgs: 2,
    examples: ["RIGHT([Telefono], 4)"],
    implementation: (v, n) => {
      const s = str(v);
      const len = Math.max(0, Math.floor(num(n)));
      return len === 0 ? "" : s.slice(-len);
    },
  },
  {
    name: "MID",
    description: "Extrae N caracteres empezando en la posición inicial (base 1)",
    category: "texto",
    minArgs: 3,
    maxArgs: 3,
    examples: ["MID([Segmento_Zona], 1, 3)"],
    implementation: (v, start, len) => {
      const idx = Math.max(0, Math.floor(num(start)) - 1);
      const count = Math.max(0, Math.floor(num(len)));
      return str(v).slice(idx, idx + count);
    },
  },
  {
    name: "CONCAT",
    description: "Une varios textos o columnas en una sola cadena",
    category: "texto",
    minArgs: 1,
    maxArgs: 12,
    examples: ['CONCAT([Ciudad], ", ", [Estado])'],
    implementation: (...args) => args.map(str).join(""),
  },
  {
    name: "SUBSTITUTE",
    description: "Reemplaza todas las ocurrencias de un texto por otro",
    category: "texto",
    minArgs: 3,
    maxArgs: 3,
    examples: ['SUBSTITUTE([Ciudad], "Cd.", "Ciudad")'],
    implementation: (v, search, rep) => {
      const target = str(search);
      return target === "" ? str(v) : str(v).split(target).join(str(rep));
    },
  },
  {
    name: "REPLACE",
    description: "Reemplaza caracteres por posición (texto, inicio, longitud, nuevo)",
    category: "texto",
    minArgs: 4,
    maxArgs: 4,
    examples: ['REPLACE([Telefono], 1, 2, "55")'],
    implementation: (v, start, len, rep) => {
      const s = str(v);
      const idx = Math.max(0, Math.floor(num(start)) - 1);
      const count = Math.max(0, Math.floor(num(len)));
      return s.slice(0, idx) + str(rep) + s.slice(idx + count);
    },
  },
  {
    name: "FIND",
    description: "Busca la posición (base 1) de un texto dentro de otro (0 si no existe)",
    category: "texto",
    minArgs: 2,
    maxArgs: 2,
    examples: ['FIND(" ", [Nombre_Cliente])'],
    implementation: (needle, haystack) => {
      const idx = str(haystack).indexOf(str(needle));
      return idx === -1 ? 0 : idx + 1;
    },
  },
  {
    name: "REMOVE_ACCENTS",
    description: "Quita acentos y diéresis del texto (á → a, ñ se conserva)",
    category: "texto",
    minArgs: 1,
    maxArgs: 1,
    examples: ["REMOVE_ACCENTS([Ciudad])"],
    implementation: (v) =>
      str(v)
        .replace(/ñ/g, "\u0000")
        .replace(/Ñ/g, "\u0001")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\u0000/g, "ñ")
        .replace(/\u0001/g, "Ñ"),
  },
  {
    name: "REMOVE_EXTRA_SPACES",
    description: "Recorta extremos y colapsa múltiples espacios internos a uno solo",
    category: "texto",
    minArgs: 1,
    maxArgs: 1,
    examples: ["REMOVE_EXTRA_SPACES([Nombre_Cliente])"],
    implementation: (v) => str(v).trim().replace(/\s+/g, " "),
  },
  {
    name: "REMOVE_NON_ALNUM",
    description: "Conserva únicamente letras, números y espacios",
    category: "texto",
    minArgs: 1,
    maxArgs: 1,
    examples: ["REMOVE_NON_ALNUM([ID_Cliente])"],
    implementation: (v) => removeAccents(str(v)).replace(/[^A-Za-z0-9\s]/g, ""),
  },
  {
    name: "TITLE_CASE_MX",
    description: "Tipo Título respetando conectores en español (de, del, la, los, y)",
    category: "texto",
    minArgs: 1,
    maxArgs: 1,
    examples: ["TITLE_CASE_MX([Nombre_Cliente])"],
    implementation: (v) => {
      const minor = new Set(["de", "del", "la", "las", "los", "y", "e", "en", "a"]);
      return str(v)
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .map((w, idx) => (idx > 0 && minor.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
        .join(" ");
    },
  },

  // ======================== LÓGICA Y NULOS (11) ========================
  {
    name: "IF",
    description: "Si se cumple la condición devuelve valor_verdadero, si no valor_falso",
    category: "logica",
    minArgs: 3,
    maxArgs: 3,
    examples: ['IF(ISBLANK([Telefono]), "Pendiente", [Telefono])'],
    implementation: (cond, a, b) => (Boolean(cond) ? a : b),
  },
  {
    name: "IFS",
    description: "Evalúa pares condición, resultado en orden",
    category: "logica",
    minArgs: 2,
    maxArgs: 16,
    examples: ['IFS(VALUE([Monto_MXN]) > 10000, "Alto", TRUE, "Normal")'],
    implementation: (...args) => {
      for (let i = 0; i + 1 < args.length; i += 2) {
        if (Boolean(args[i])) return args[i + 1];
      }
      return "";
    },
  },
  {
    name: "SWITCH",
    description: "Compara una expresión contra varios casos y un valor por defecto",
    category: "logica",
    minArgs: 3,
    maxArgs: 16,
    examples: ['SWITCH([Estado], "Tab", "Tabasco", "CDMX", "Ciudad de México", [Estado])'],
    implementation: (expr, ...rest) => {
      const target = str(expr);
      for (let i = 0; i + 1 < rest.length; i += 2) {
        if (str(rest[i]) === target) return rest[i + 1];
      }
      return rest.length % 2 === 1 ? rest[rest.length - 1] : "";
    },
  },
  {
    name: "AND",
    description: "Verdadero si todas las condiciones son verdaderas",
    category: "logica",
    minArgs: 1,
    maxArgs: 10,
    examples: ["AND(NOT(ISBLANK([Ciudad])), NOT(ISBLANK([Estado])))"],
    implementation: (...args) => args.every(Boolean),
  },
  {
    name: "OR",
    description: "Verdadero si al menos una condición es verdadera",
    category: "logica",
    minArgs: 1,
    maxArgs: 10,
    examples: ['OR([Ciudad] = "CDMX", [Ciudad] = "Monterrey")'],
    implementation: (...args) => args.some(Boolean),
  },
  {
    name: "NOT",
    description: "Invierte un valor booleano (TRUE → FALSE)",
    category: "logica",
    minArgs: 1,
    maxArgs: 1,
    examples: ["NOT(ISBLANK([Telefono]))"],
    implementation: (v) => !Boolean(v),
  },
  {
    name: "ISBLANK",
    description: "Devuelve TRUE si la celda está vacía o solo tiene espacios",
    category: "logica",
    minArgs: 1,
    maxArgs: 1,
    examples: ["ISBLANK([Telefono])"],
    implementation: (v) => isBlankVal(v),
  },
  {
    name: "IFBLANK",
    description: "Si la columna está vacía, devuelve el valor de respaldo",
    category: "logica",
    minArgs: 2,
    maxArgs: 2,
    examples: ['IFBLANK([Ciudad], "Sin dato")'],
    implementation: (v, fallback) => (isBlankVal(v) ? fallback : v),
  },
  {
    name: "COALESCE",
    description: "Devuelve el primer valor que no esté vacío",
    category: "logica",
    minArgs: 1,
    maxArgs: 10,
    examples: ['COALESCE([Telefono], [ID_Cliente], "Sin contacto")'],
    implementation: (...args) => {
      for (const a of args) {
        if (!isBlankVal(a)) return a;
      }
      return "";
    },
  },
  {
    name: "ISNUMBER",
    description: "Devuelve TRUE si el texto representa un número válido",
    category: "logica",
    minArgs: 1,
    maxArgs: 1,
    examples: ["ISNUMBER([Monto_MXN])"],
    implementation: (v) => {
      if (typeof v === "number") return Number.isFinite(v);
      const cleaned = str(v).trim().replace(/[$,\s]/g, "");
      return cleaned !== "" && /^-?\d+(\.\d+)?$/.test(cleaned);
    },
  },
  {
    name: "ISTEXT",
    description: "Devuelve TRUE si la celda contiene texto no numérico",
    category: "logica",
    minArgs: 1,
    maxArgs: 1,
    examples: ["ISTEXT([Nombre_Cliente])"],
    implementation: (v) => !isBlankVal(v) && typeof v === "string",
  },
  {
    name: "BLANK",
    description: "Devuelve cadena vacía",
    category: "logica",
    minArgs: 0,
    maxArgs: 0,
    examples: ["BLANK()"],
    implementation: () => "",
  },

  // ======================== NÚMEROS (5) ========================
  {
    name: "VALUE",
    description: "Convierte texto numérico ($1,200.50) a número",
    category: "numeros",
    minArgs: 1,
    maxArgs: 1,
    examples: ["VALUE([Monto_MXN])"],
    implementation: (v) => num(v),
  },
  {
    name: "ROUND",
    description: "Redondea un número a N decimales (por defecto 0)",
    category: "numeros",
    minArgs: 1,
    maxArgs: 2,
    examples: ["ROUND(VALUE([Monto_MXN]), 2)"],
    implementation: (v, dec = 0) => {
      const d = Math.max(0, Math.min(6, Math.floor(num(dec))));
      const factor = Math.pow(10, d);
      return Math.round(num(v) * factor) / factor;
    },
  },
  {
    name: "INT",
    description: "Devuelve la parte entera hacia abajo",
    category: "numeros",
    minArgs: 1,
    maxArgs: 1,
    examples: ["INT(VALUE([Monto_MXN]))"],
    implementation: (v) => Math.floor(num(v)),
  },
  {
    name: "ABS",
    description: "Devuelve el valor absoluto de un número",
    category: "numeros",
    minArgs: 1,
    maxArgs: 1,
    examples: ["ABS(VALUE([Monto_MXN]))"],
    implementation: (v) => Math.abs(num(v)),
  },
  {
    name: "NUMBER_FORMAT_MX",
    description: "Formatea un número con separador de miles y decimales (1,250.00)",
    category: "numeros",
    minArgs: 1,
    maxArgs: 2,
    examples: ["NUMBER_FORMAT_MX(VALUE([Monto_MXN]), 2)"],
    implementation: (v, dec = 2) => {
      const d = Math.max(0, Math.min(4, Math.floor(num(dec))));
      return num(v).toLocaleString("es-MX", {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      });
    },
  },

  // ======================== FECHAS (7) ========================
  {
    name: "DATEVALUE",
    description: "Normaliza cualquier fecha válida a texto ISO YYYY-MM-DD",
    category: "fechas",
    minArgs: 1,
    maxArgs: 1,
    examples: ["DATEVALUE([Fecha_Alta])"],
    implementation: (v) => standardizeDateValue(str(v), "iso"),
  },
  {
    name: "DATE",
    description: "Construye una fecha YYYY-MM-DD desde año, mes, día",
    category: "fechas",
    minArgs: 3,
    maxArgs: 3,
    examples: ["DATE(2025, 1, 14)"],
    implementation: (y, m, d) => {
      const yy = Math.floor(num(y));
      const mm = String(Math.max(1, Math.min(12, Math.floor(num(m))))).padStart(2, "0");
      const dd = String(Math.max(1, Math.min(31, Math.floor(num(d))))).padStart(2, "0");
      return `${yy}-${mm}-${dd}`;
    },
  },
  {
    name: "YEAR",
    description: "Extrae el año (4 dígitos) de una fecha",
    category: "fechas",
    minArgs: 1,
    maxArgs: 1,
    examples: ["YEAR([Fecha_Alta])"],
    implementation: (v) => parseCalendarDate(str(v), true)?.year ?? "",
  },
  {
    name: "MONTH",
    description: "Extrae el mes (1-12) de una fecha",
    category: "fechas",
    minArgs: 1,
    maxArgs: 1,
    examples: ["MONTH([Fecha_Alta])"],
    implementation: (v) => parseCalendarDate(str(v), true)?.month ?? "",
  },
  {
    name: "DAY",
    description: "Extrae el día (1-31) de una fecha",
    category: "fechas",
    minArgs: 1,
    maxArgs: 1,
    examples: ["DAY([Fecha_Alta])"],
    implementation: (v) => parseCalendarDate(str(v), true)?.day ?? "",
  },
  {
    name: "FORMAT_DATE_MX",
    description: "Estandariza una fecha al formato DD/MM/AAAA",
    category: "fechas",
    minArgs: 1,
    maxArgs: 1,
    examples: ["FORMAT_DATE_MX([Fecha_Alta])"],
    implementation: (v) => standardizeDateValue(str(v), "dmy_slash"),
  },
  {
    name: "PARSE_DATE_MX",
    description: "Interpreta fechas mexicanas (DD/MM/AAAA o texto) y devuelve ISO YYYY-MM-DD",
    category: "fechas",
    minArgs: 1,
    maxArgs: 1,
    examples: ["PARSE_DATE_MX([Fecha_Alta])"],
    implementation: (v) => standardizeDateValue(str(v), "iso"),
  },

  // ======================== MÉXICO / CÓDIGOS (8) ========================
  {
    name: "EXTRACT_NUMBERS",
    description: "Extrae solo dígitos y decimales limpios",
    category: "mexico",
    minArgs: 1,
    maxArgs: 1,
    examples: ["EXTRACT_NUMBERS([Telefono])"],
    implementation: (v) => extractCleanNumber(str(v)),
  },
  {
    name: "PAD_CP",
    description: "Normaliza código postal mexicano a 5 dígitos con cero inicial",
    category: "mexico",
    minArgs: 1,
    maxArgs: 1,
    examples: ["PAD_CP([Codigo_Postal])"],
    implementation: (v) => padMexicanPostalCode(str(v)),
  },
  {
    name: "EXTRACT_CP",
    description: "Extrae el primer código postal de 5 dígitos dentro de una dirección",
    category: "mexico",
    minArgs: 1,
    maxArgs: 1,
    examples: ["EXTRACT_CP([Direccion])"],
    implementation: (v) => {
      const m = str(v).match(/\b\d{5}\b/);
      return m ? m[0] : "";
    },
  },
  {
    name: "NORMALIZE_CURP",
    description: "Limpia espacios/guiones y convierte a mayúsculas una CURP (18 caracteres)",
    category: "mexico",
    minArgs: 1,
    maxArgs: 1,
    examples: ["NORMALIZE_CURP([CURP])"],
    implementation: (v) => removeAccents(str(v)).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 18),
  },
  {
    name: "NORMALIZE_RFC",
    description: "Limpia espacios/guiones y convierte a mayúsculas un RFC (12-13 caracteres)",
    category: "mexico",
    minArgs: 1,
    maxArgs: 1,
    examples: ["NORMALIZE_RFC([RFC])"],
    implementation: (v) => removeAccents(str(v)).toUpperCase().replace(/[^A-Z0-9&]/g, "").slice(0, 13),
  },
  {
    name: "NORMALIZE_PHONE_MX",
    description: "Limpia un teléfono mexicano a 10 dígitos (o con prefijo +52 si tiene 10)",
    category: "mexico",
    minArgs: 1,
    maxArgs: 1,
    examples: ["NORMALIZE_PHONE_MX([Telefono])"],
    implementation: (v) => {
      const digits = str(v).replace(/\D+/g, "");
      if (!digits) return "";
      const local10 = digits.length > 10 && digits.startsWith("52") ? digits.slice(-10) : digits;
      return local10.length === 10 ? `+52 ${local10}` : local10;
    },
  },
  {
    name: "CLEAN",
    description: "Elimina caracteres de control no imprimibles y recorta espacios",
    category: "mexico",
    minArgs: 1,
    maxArgs: 1,
    examples: ["CLEAN([Nombre_Cliente])"],
    implementation: (v) => str(v).replace(/[\u0000-\u001F\u007F]/g, "").trim(),
  },
  {
    name: "TRIM_ALL",
    description: "Elimina saltos de línea, tabuladores y espacios repetidos",
    category: "mexico",
    minArgs: 1,
    maxArgs: 1,
    examples: ["TRIM_ALL([Nombre_Cliente])"],
    implementation: (v) => str(v).replace(/\s+/g, " ").trim(),
  },
];

export const FORMULA_REGISTRY: Record<string, FormulaFunctionDef> = Object.fromEntries(
  FUNCTIONS.map((fn) => [fn.name, fn])
);

export const FORMULA_FUNCTION_LIST = FUNCTIONS;
