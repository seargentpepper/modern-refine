# Guía del Aprendiz: Limpieza de Datos, Recetas y Fórmulas Seguras en ModernRefine

Bienvenido a **ModernRefine**. Si vienes de Excel, de hojas de cálculo tradicionales o estás dando tus primeros pasos en análisis de datos, esta guía te enseñará la regla más importante de esta estación de trabajo:

> **Aquí es imposible arruinar tus datos.**  
> Cada cambio que haces no destruye el archivo original; se anota como una instrucción transparente en una **Receta**. Si te equivocas, apagas la instrucción o la borras, y tus datos regresan intactos al instante.

---

## 1. El gran problema de Excel frente a la "Receta" de ModernRefine

En Excel, cuando aplicas un *Buscar y Reemplazar* o ejecutas una macro sobre 50,000 filas:
1. El archivo se modifica directamente sobre las celdas.
2. Si cometes un error y guardas, **perdiste tus datos originales**.
3. El próximo mes, cuando recibas el mismo archivo sucio de clientes o ventas, tienes que **volver a repetir todos los clics a mano**.

### Cómo lo resuelve ModernRefine: La Receta de Cocina
Imagina que tus datos crudos son los ingredientes frescos. ModernRefine nunca altera los ingredientes:
- **Tus datos originales (`baseRows`) se congelan en memoria.**
- Cada acción (quitar espacios, convertir a mayúsculas, rellenar celdas vacías o aplicar una fórmula) es solo **un paso anotado en una receta**.
- Puedes ver el resultado final en la tabla en tiempo real porque ModernRefine recalcula los pasos en milisegundos.

```text
[Archivo Original Sucio] 
       ↓ (Paso 1: Quitar espacios en "Nombre")
       ↓ (Paso 2: Rellenar vacíos en "Telefono" con "Sin dato")
       ↓ (Paso 3: Fórmula personalizada en "Monto")
[Tabla Limpia Lista para Exportar]
```

Si el Paso 2 no te gustó, simplemente **desmarcas su casilla** en el panel de Historial y desaparece sin alterar los demás pasos.

---

## 2. El Catálogo del 90%: Lo que resuelves con un solo clic

El 90% de los dolores de cabeza al limpiar datos en América Latina y México son siempre los mismos. ModernRefine incluye botones oficiales listos en el **Panel Izquierdo** para resolverlos:

| Problema Típico en Excel | Solución en ModernRefine (1 Clic) | Qué hace por debajo |
| :--- | :--- | :--- |
| Nombres con espacios dobles o al final | **Quitar espacios** | Elimina espacios al inicio, final y dobles internos. |
| Textos mezclados (`juan`, `JUAN`, `Juan`) | **MAYÚSCULAS / Tipo Título** | Homologa el formato de nombres o categorías. |
| Letras con acentos que rompen bases de datos | **Sin acentos** | Cambia `Mérida`, `Cancún`, `Ángel` por `Merida`, `Cancun`, `Angel`. |
| Celdas vacías que rompen tablas dinámicas | **Vacíos → Sin dato** | Sustituye celdas vacías por un valor seguro. |
| Excel se comió el cero de códigos postales | **CP 5 dígitos (0...)** | Convierte `8600` en `08600` automáticamente. |
| Monedas con texto (`"$1,500.50 MXN"`) | **Solo números** | Remueve signos de pesos, comas y letras dejando dígitos limpios. |
| Nombres completos en una sola celda | **Separar en Nombre(s) + 2 Apellidos** | Algoritmo inteligente que respeta partículas (`de la`, `del`). |

---

## 3. Fórmulas Inteligentes: El 10% que puedes crear con un Asistente / LLM

¿Qué pasa cuando necesitas una limpieza única que no tiene botón oficial?  
*Por ejemplo: "Si el teléfono tiene 10 dígitos agrégale la lada +52, pero si está vacío pon 'No registrado'".*

Para esto existe el **Motor de Fórmulas Seguras** y la colaboración con asistentes de Inteligencia Artificial (ChatGPT, Claude, Gemini o modelos locales).

### La regla de oro de seguridad de ModernRefine
ModernRefine **NUNCA ejecuta código JavaScript libre (`eval`)**.  
Un asistente de IA nunca tiene acceso a tu computadora ni a tus archivos; el asistente solo te sugiere **texto en una fórmula segura** y nuestro motor interno valida que use únicamente las funciones autorizadas.

---

## 4. Las Funciones Permitidas (Tu Guía de Bolsillo)

Puedes usar estas funciones combinadas tal como lo harías en Excel:

### A. Texto y Limpieza
- `TRIM([Columna])`: Quita espacios sobrantes.
- `UPPER([Columna])` / `LOWER([Columna])` / `PROPER([Columna])`: Mayúsculas, minúsculas o Tipo Título.
- `REMOVE_ACCENTS([Columna])`: Elimina tildes y diéresis.
- `LEFT([Columna], N)` / `RIGHT([Columna], N)` / `MID([Columna], inicio, N)`: Corta fragmentos de texto.
- `CONCAT([Col1], " - ", [Col2])` o usando `&`: Une textos (`[Ciudad] & ", " & [Estado]`).
- `SUBSTITUTE([Columna], "texto_viejo", "texto_nuevo")`: Reemplazo de palabras.

### B. Lógica y Condiciones
- `IF(condición, valor_si_verdadero, valor_si_falso)`:
  - Ejemplo: `IF(ISBLANK([Telefono]), "Sin contacto", [Telefono])`
- `ISBLANK([Columna])`: Devuelve verdadero si la celda no tiene dato.
- `IFBLANK([Columna], "Reemplazo")`: Atajo directo para rellenar vacíos.
- `COALESCE([Col1], [Col2], "Valor final")`: Toma el primer valor que no esté vacío.

### C. Códigos y Especiales de México
- `EXTRACT_NUMBERS([Columna])`: Extrae únicamente los dígitos de una celda.
- `PAD_CP([Codigo_Postal])`: Asegura 5 dígitos anteponiendo ceros.
- `FORMAT_DATE_MX([Fecha])`: Estandariza fechas a formato mexicano/latino `DD/MM/AAAA`.

---

## 5. El Ciclo de Vida de una Fórmula: Probar, Cocinar y Aplicar

Cuando creas una fórmula o se la pides a un LLM, sigues este flujo de 4 pasos dentro de ModernRefine:

```text
1. BORRADOR          2. PREVIEW (5 Filas)       3. APLICADA               4. REMOVER
[Escribes o pegas] → [Ves antes/después]    →  [Entra a la Receta]   →   [Apagas o eliminas]
la fórmula           sin tocar tu tabla        activa en 100k filas      cuando no la ocupes
```

### Paso 1: Pedirle la fórmula al LLM
Puedes copiar y pegar este mensaje exacto a cualquier IA:

> *"Actúa como instructor de ModernRefine. Necesito una fórmula segura usando columnas entre corchetes `[Columna]`.  
> Mis columnas son: `[Nombre_Cliente]`, `[Ciudad]`, `[Telefono]`.  
> Tarea: Si el teléfono no está vacío, límpialo para que tenga solo números y agrégale '+52 '; si está vacío pon 'Pendiente'.  
> Usa únicamente funciones de esta lista: IF, ISBLANK, EXTRACT_NUMBERS, TRIM, CONCAT o el operador &. Devuelve solo la fórmula."*

La IA te responderá:
```text
IF(ISBLANK([Telefono]), "Pendiente", "+52 " & EXTRACT_NUMBERS([Telefono]))
```

### Paso 2: Vista previa (Preview de 5 filas)
En la barra de **Fórmula Rápida (`fx`)** de ModernRefine:
1. Pegas la expresión.
2. Seleccionas si quieres **Reemplazar la columna actual** o **Crear una nueva columna**.
3. Haces clic en **Probar en 5 filas**.
4. ModernRefine te muestra una pequeña tarjeta comparativa:
   - *Antes:* `"(993) 312-4455"` $\to$ *Después:* `"+52 9933124455"`
   - *Antes:* `""` $\to$ *Después:* `"Pendiente"`

### Paso 3: Aplicar a la Receta
Si el resultado te convence, presionas **Aplicar**.  
Inmediatamente:
- Se evalúa sobre toda tu tabla (incluso si tiene 200,000 filas).
- Aparece en el panel derecho bajo el acordeón **"Fórmulas y Cálculos Personalizados"**.

### Paso 4: Activar, Desactivar o Remover
- **Desactivar temporalmente:** Desmarcas la casilla junto al paso. La columna regresa a su estado previo al instante.
- **Remover definitivamente:** Haces clic en el icono del bote de basura del paso para eliminarlo de la receta.

---

## 6. Ejercicios Prácticos para Aprender

Aquí tienes 4 retos clásicos que puedes probar hoy mismo en ModernRefine cargando la plantilla `clientes_sucursales_sucios.csv`:

### Reto 1: Estandarizar Ciudades y Estados
* **Objetivo:** Crear una columna de ubicación limpia en mayúsculas sin acentos.
* **Fórmula:**
  ```text
  UPPER(REMOVE_ACCENTS([Ciudad])) & " (" & UPPER(REMOVE_ACCENTS([Estado])) & ")"
  ```
* **Resultado:** `VILLAHERMOSA (TABASCO)`

### Reto 2: Clientes sin teléfono
* **Objetivo:** Identificar clientes que requieren seguimiento telefónico.
* **Fórmula:**
  ```text
  IF(ISBLANK([Telefono]), "URGENTE_CONTACTAR", "OK")
  ```

### Reto 3: Normalización de montos
* **Objetivo:** Si el monto de compra es superior a 10,000 clasificar como "Cliente Preferente", de lo contrario "Estándar".
* **Fórmula:**
  ```text
  IF(VALUE([Monto_MXN]) >= 10000, "Preferente", "Estándar")
  ```

### Reto 4: Reparar Código Postal
* **Objetivo:** Garantizar que todo código postal tenga 5 dígitos exactos con ceros a la izquierda.
* **Fórmula:**
  ```text
  PAD_CP([Codigo_Postal])
  ```

---

## 7. Consejos de Buenas Prácticas
1. **Verifica siempre los diagnósticos:** Antes de aplicar una fórmula, fíjate en las etiquetas del panel izquierdo (`X variantes`, `Y vacías`). Te dirán si tu columna está realmente sucia.
2. **Usa el doble clic:** Haz doble clic en cualquier celda para abrir el **Resumen rápido de columna** y confirmar el valor mínimo, máximo y celdas con dato.
3. **Guarda tu receta (`Ctrl+S`):** Cuando termines de limpiar, ve a `Archivo > Recetas > Guardar Receta`. El archivo `.refine.json` pesa unos pocos kilobytes y podrás reusarlo infinitas veces sobre nuevos reportes con la misma estructura.
