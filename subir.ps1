# --- CONFIGURA ESTO UNA SOLA VEZ ---
$repoNombre = "modern-refine"
$descripcion = "Modern Refine - Frontend + Motor Rust"
$visibilidad = "private" # cambia a "public" si lo quieres publico

# --- NO TOQUES DE AQUI PARA ABAJO ---
Set-Location "C:\Users\Admin\Github\Analytics\Analyticraft\modern-refine"

# 1. .gitignore si no existe
if (-not (Test-Path ".gitignore")) {
@"
node_modules/
dist/
target/
.DS_Store
.env
.env.local
*.log
"@ | Out-File -Encoding utf8 ".gitignore"
}

# 2. Git init si no existe
if (-not (Test-Path ".git")) { git init }

git add .
git commit -m "Initial commit: modern-refine" 2>$null
if ($LASTEXITCODE -ne 0) { git commit -m "Update: modern-refine" }

# 3. Crear repo en GitHub y subir
git branch -M main
gh repo create $repoNombre --description $descripcion --$visibilidad --source=. --remote=origin --push

Write-Host "`nListo! Repo subido." -ForegroundColor Green
