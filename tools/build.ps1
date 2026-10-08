# Build zotero-vim-plus.xpi on Windows (PowerShell 5.1+).
# Equivalent of build.sh — creates a POSIX-path zip that Gecko can read
# (never use Compress-Archive: it writes backslash entry paths that break
# Zotero's jar:// loading).
# Usage: powershell -ExecutionPolicy Bypass -File tools\build.ps1
param(
    [string]$Root = ($PSScriptRoot | Split-Path -Parent),
    [string]$Output = "zoetero-vim-plus.xpi"
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path -LiteralPath $Root).Path

# Optional sanity checks (mirror build.sh).
if (Get-Command node -ErrorAction SilentlyContinue) {
    Push-Location $Root
    try {
        foreach ($source in @(
            'bootstrap.js', 'content/i18n.js', 'content/zoteroVim.js',
            'content/zoteroVimReader.js', 'content/zoteroVimMain.js',
            'content/zoteroVimNoteDiagnostics.js', 'content/prefs.js'
        )) {
            node --check $source
            if ($LASTEXITCODE -ne 0) { throw "Syntax check failed: $source" }
        }
        foreach ($check in @(
            'tools/check-sync.js', 'tools/check-bindings.js',
            'tools/check-reader-history.js', 'tools/check-plugin-manifest.js',
            'tools/check-reader-layout.js',
            'tools/check-reader-text.js',
            'tools/check-note-editor-routing.js',
            'tools/check-note-native-input.js',
            'tools/check-note-input-guard.js',
            'tools/check-note-diagnostics.js',
            'tools/check-note-editing.js', 'tools/check-note-line-numbers.js',
            'tools/check-note-advanced.js',
            'tools/check-insert-mode-shifts.js',
            'tools/check-count-digit-guard.js', 'tools/check-reader-listeners.js'
        )) {
            node $check
            if ($LASTEXITCODE -ne 0) { throw "Regression check failed: $check" }
        }
    } finally {
        Pop-Location
    }
} else {
    Write-Host "Warning: node not found - skipping syntax and sync checks."
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$outPath = Join-Path $Root $Output

Remove-Item -LiteralPath $outPath -ErrorAction SilentlyContinue

$files = @()
$files += Join-Path $Root "manifest.json"
$files += Join-Path $Root "bootstrap.js"
$files += Get-ChildItem -LiteralPath (Join-Path $Root "content") -File | ForEach-Object { $_.FullName }
$files += Get-ChildItem -LiteralPath (Join-Path $Root "icons") -File | ForEach-Object { $_.FullName }

$fs = [System.IO.File]::Create($outPath)
$zip = New-Object System.IO.Compression.ZipArchive(
    $fs,
    [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($f in $files) {
        $rel = $f.Substring($Root.Length + 1).Replace('\', '/')
        $entry = $zip.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
        $stream = $entry.Open()
        try {
            $bytes = [System.IO.File]::ReadAllBytes($f)
            $stream.Write($bytes, 0, $bytes.Length)
        } finally {
            $stream.Dispose()
        }
    }
} finally {
    $zip.Dispose()
    $fs.Dispose()
}

Write-Host "Done: $Output"
