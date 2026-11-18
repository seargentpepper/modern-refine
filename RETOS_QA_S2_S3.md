# Retos de Pruebas QA — ModernRefine (Semana 2 y 3)

Guía práctica paso a paso para corroborar desde la interfaz de usuario que todas las capacidades nuevas de **Semana 2 y 3** funcionan correctamente sobre [`clientes_sucursales_sucios.csv`](./clientes_sucursales_sucios.csv) (34 filas, 9 columnas) sin romper lo logrado en Fase 1.

---

## Reto 1: Retrocompatibilidad con tu Receta `.refine.json` de Fase 1
1. Abre la app (`npm run dev`) y selecciona la plantilla `clientes_sucursales_sucios.csv`.
2. Haz clic en **Cargar Receta** y selecciona el archivo `.refine.json` que guardaste en Fase 1.
3. **Resultado esperado:** Los pasos previos deben aplicarse limpiamente sobre las primeras 18 filas (`C-001` a `C-018`) sin errores ni desplazamientos, y podrás seguir limpiando las filas nuevas (`C-019` a `C-034`).

---

## Reto 2: Los 5 Algoritmos de Clustering en Español
1. Haz clic en la cabecera **`Ciudad`** y abre la pestaña **Clústeres**.
2. Prueba los botones de filtro por método arriba de los clústeres:
   - **Fonético ES:** Debe agrupar `Villahermosa` / `Biya Hermosa` / `Billa Ermosa`, `Xalapa` / `Jalapa` y `Cancún` / `Kankun`.
   - **N-gram:** Debe detectar transposiciones como `Guadalajara` / `Gaudalajara` / `Guadalaraja` y `Monterrey` / `Monetrrey`.
   - **Abreviatura:** Debe agrupar `Gdl` ↔ `Guadalajara` y `Mty` ↔ `Monterrey`.
3. Haz clic en **`Elegir`** junto al nombre limpio deseado (ej. `Guadalajara`) y verifica que todas las variantes del grupo se unifican en 1 clic.

---

## Reto 3: Códigos Postales sin Cero Inicial (`CP 5 dígitos`)
1. Selecciona la columna **`Codigo_Postal`**.
2. **Resultado esperado en diagnóstico:** Debe aparecer el chip de advertencia **`X CP sin cero inicial`** (por valores como `8600`, `1000`, `6600`, `3100`).
3. Haz clic en **`CP 5 dígitos (0...)`**.
4. **Resultado esperado:** `8600` pasa a `08600`, `1000` pasa a `01000`, y el chip de advertencia desaparece.

---

## Reto 4: Limpieza de Monedas y Teléfonos (`Solo números`)
1. Selecciona **`Monto_MXN`** (contiene valores como `"$15,750.00"` y `"$24,800"`).
   - Haz clic en **`Solo números`** → debe quedar `15750.00` y `24800` preservando el punto decimal.
2. Selecciona **`Telefono`** (contiene `(993) 312-4455`, `Tel: 9931902211`, `993.315.7766`).
   - Haz clic en **`Solo números`** → todos deben quedar como dígitos puros (`9933124455`, `9931902211`, `9933157766`).

---

## Reto 5: Separación de Columna Compuesta (`Separar izq (-)`)
1. Selecciona **`Segmento_Zona`** (`Mayorista - Sur`, `PyME - Centro`, `Corporativo - Norte`).
2. Haz clic en **`Separar izq (-)`**.
3. **Resultado esperado:** Toda la columna se limpia dejando únicamente el segmento (`Mayorista`, `PyME`, `Corporativo`, `Menudeo`).

---

## Reto 6: Homologación Masiva de Fechas Complejas
1. Haz clic en la cabecera **`Fecha_Alta`**.
2. Verifica que **solo** en esta columna aparece la barra azul superior de reformateo de fechas (y desaparece al cambiar a `Ciudad` o `Telefono`).
3. Elige **`ISO AAAA-MM-DD`** y haz clic en **`Reformatear toda la columna`**.
4. **Resultado esperado:** Deben homologarse al mismo formato tanto fechas con barras (`14/01/2025`), texto en español (`14 de marzo de 2025`, `19-abr-2025`, `2 de junio de 2025`), seriales numéricos de Excel (`45762`, `45790`) como fechas desbordadas (`30/02/2025`, `15/13/2025`, `31/04/2025`).

---

## Reto 7: Exportación e Importación Real en Excel (`.xlsx`)
1. Haz clic en **`Exportar XLSX`** en la barra superior para descargar `clientes_sucursales_sucios_limpio.xlsx`.
2. Cierra la tabla desde el selector superior (**`— Cerrar tabla (Inicio limpio) —`**).
3. Haz clic en **`Abrir CSV`** y selecciona el `.xlsx` que acabas de exportar (o cualquier Excel propio con varias hojas).
4. **Resultado esperado:** El archivo `.xlsx` se carga en la tabla y, si tiene múltiples hojas, aparece el selector **`Hoja: ...`** en la barra superior.
