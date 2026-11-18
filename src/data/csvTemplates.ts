export interface CsvTemplate {
  name: string;
  content: string;
}

// Descubre automáticamente cualquier archivo .csv colocado en la raíz de modern-refine/
const rawTemplates = import.meta.glob("../../*.csv", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const ROOT_CSV_TEMPLATES: CsvTemplate[] = Object.entries(rawTemplates)
  .map(([path, content]) => ({
    name: path.split("/").pop() ?? path,
    content,
  }))
  .sort((a, b) => a.name.localeCompare(b.name, "es"));
