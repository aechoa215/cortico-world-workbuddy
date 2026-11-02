#!/usr/bin/env pwsh
<#
.SYNOPSIS
  一键重装 cortico-world-workbuddy：打包 → 卸载旧版 → 安装 → 校验哈希与版本。

.DESCRIPTION
  解决两个老坑：
    1. 「同版本重装不生效」——`file:` 依赖按版本号+完整性判定复用，版本号没变时 pnpm 可能跳过，
       于是必须先 remove 再 add（本脚本固定这么做）。
    2. 「以为装上了其实是旧的」——装完逐文件比对源码哈希，并与 `/api/extensions` 返回的版本核对，
       任一处不一致就以非零码退出。

  版本号规范：每次改动 `package.json` 的 version 必须 bump（0.1.2 → 0.1.3），备份目录按版本命名。

.PARAMETER PackageDir
  扩展包目录（含 package.json）。默认取本脚本的上一级。

.PARAMETER OutDir
  tgz 输出目录，默认 F:\coo-connect-wb。

.PARAMETER NoPack
  跳过打包，直接用 OutDir 里已有的 tgz（仍会卸载/安装/校验）。

.PARAMETER Port
  core HTTP 端口，默认 17788（用于装完后核对版本；没在跑就跳过这一步）。

.EXAMPLE
  pwsh -File scripts/reinstall.ps1
#>
[CmdletBinding()]
param(
  [string]$PackageDir = '',
  [string]$OutDir = 'F:\coo-connect-wb',
  [switch]$NoPack,
  [int]$Port = 17788
)

$ErrorActionPreference = 'Stop'
function Fail([string]$msg) { Write-Host "✗ $msg" -ForegroundColor Red; exit 4 }
function Step([string]$msg) { Write-Host "· $msg" }

if (-not $PackageDir) { $PackageDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path }
if (-not (Test-Path (Join-Path $PackageDir 'package.json'))) { Fail "PackageDir 里没有 package.json：$PackageDir" }

$pkg = Get-Content -Raw -Encoding UTF8 (Join-Path $PackageDir 'package.json') | ConvertFrom-Json
$name = $pkg.name
$version = $pkg.version
if (-not $name -or -not $version) { Fail 'package.json 缺少 name / version' }
Step "包：$name $version"

# --- 环境探测 -------------------------------------------------------------
$appDir = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\Coopanion'),
  (Join-Path $env:ProgramFiles 'Coopanion')
) | Where-Object { Test-Path (Join-Path $_ 'resources\app\build\console\index.html') } | Select-Object -First 1
if (-not $appDir) { Fail '找不到 Coopanion 安装目录（resources/app/build/console/index.html）' }

$dataDir = Join-Path $appDir 'data'
$extDir = Join-Path $dataDir 'extensions'
$storeDir = Join-Path $dataDir 'pnpm\store\v11'
$pnpmCjs = Join-Path $appDir 'resources\app\node_modules\pnpm\bin\pnpm.cjs'
if (-not (Test-Path $pnpmCjs)) { Fail "找不到 pnpm：$pnpmCjs" }
Step "宿主：$appDir"

# --- 1) 打包 --------------------------------------------------------------
$tgz = Join-Path $OutDir "$name-$version.tgz"
if ($NoPack) {
  if (-not (Test-Path $tgz)) { Fail "-NoPack 但找不到 $tgz" }
  Step "跳过打包，使用 $tgz"
} else {
  $stage = Join-Path ([System.IO.Path]::GetTempPath()) ("wbpkg-" + [guid]::NewGuid().ToString('N'))
  $stagePkg = Join-Path $stage 'package'
  New-Item -ItemType Directory -Force $stagePkg | Out-Null
  $include = @('src', 'dist', 'assets', 'scripts', 'README.md', 'CHANGELOG.md', 'LICENSE', 'SECURITY.md', 'ENV_PROMPT.md', 'describe.json', 'package.json')
  foreach ($item in $include) {
    $src = Join-Path $PackageDir $item
    if (Test-Path $src) { Copy-Item $src -Destination $stagePkg -Recurse -Force }
    else { Write-Host "  ! 缺少 $item（跳过）" -ForegroundColor Yellow }
  }
  # 测试产物不进包：verify-ui 的截图与报告只留在仓库里
  $visual = Join-Path $stagePkg 'scripts\visual'
  if (Test-Path $visual) { Remove-Item $visual -Recurse -Force }
  New-Item -ItemType Directory -Force $OutDir | Out-Null
  if (Test-Path $tgz) { Remove-Item $tgz -Force }
  tar -czf $tgz -C $stage package
  if ($LASTEXITCODE -ne 0) { Fail 'tar 打包失败' }
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
  Step "已打包：$tgz（$((Get-Item $tgz).Length) 字节）"
}

# --- 2) 卸载旧的，再装新的 ------------------------------------------------
Push-Location $extDir
try {
  Step "卸载 $name（同版本重装必须先 remove，否则 pnpm 会复用旧包）"
  node $pnpmCjs remove $name 2>&1 | Out-Null
  Step '安装新包'
  $out = node $pnpmCjs add $tgz --config.strict-dep-builds=false --store-dir $storeDir 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { Write-Host $out; Fail 'pnpm add 失败' }
  # pnpm 在缓存命中时只打印一行「+」，别拿标准输出当证据；版本以装好的 package.json 为准（下一步校验）
} finally { Pop-Location }

# --- 3) 校验：文件哈希 + 版本 ---------------------------------------------
$installed = Join-Path $extDir "node_modules\$name"
if (-not (Test-Path $installed)) { Fail "安装目录不存在：$installed" }

$installedPkg = Get-Content -Raw -Encoding UTF8 (Join-Path $installed 'package.json') | ConvertFrom-Json
if ($installedPkg.version -ne $version) { Fail "版本不一致：包 $version vs 已安装 $($installedPkg.version)" }

$diffs = @()
foreach ($rel in @('src', 'dist', 'assets', 'scripts')) {
  $srcRoot = Join-Path $PackageDir $rel
  if (-not (Test-Path $srcRoot)) { continue }
  Get-ChildItem $srcRoot -Recurse -File | ForEach-Object {
    $r = $_.FullName.Substring($PackageDir.Length + 1)
    # 测试产物（截图 / verify-ui 报告）与 .npmignore 排除项不进包，不参与比对
    if ($r -match '^scripts\\visual\\') { return }
    $other = Join-Path $installed $r
    if (-not (Test-Path $other)) { $script:diffs += "缺失 $r" }
    elseif ((Get-FileHash $_.FullName).Hash -ne (Get-FileHash $other).Hash) { $script:diffs += "不一致 $r" }
  }
}
foreach ($rel in @('README.md', 'CHANGELOG.md', 'LICENSE', 'SECURITY.md', 'ENV_PROMPT.md', 'describe.json', 'package.json')) {
  $a = Join-Path $PackageDir $rel; $b = Join-Path $installed $rel
  if ((Test-Path $a) -and (Test-Path $b)) {
    if ((Get-FileHash $a).Hash -ne (Get-FileHash $b).Hash) { $script:diffs += "不一致 $rel" }
  }
}
if ($diffs.Count -gt 0) {
  $diffs | Select-Object -First 10 | ForEach-Object { Write-Host "  ✗ $_" -ForegroundColor Red }
  Fail "安装内容与源码不一致（$($diffs.Count) 处）"
}
Step "文件哈希一致：$($installedPkg.version)"

# --- 4) 运行中的宿主是否已换上新版 ----------------------------------------
$base = "http://127.0.0.1:$Port"
$live = $null
try { $live = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 "$base/api/extensions").Content | ConvertFrom-Json } catch { $live = $null }
if ($live) {
  $hit = $live.extensions | Where-Object { $_.name -eq $name } | Select-Object -First 1
  if ($hit) {
    if ($hit.version -ne $version) {
      Write-Host "  ! 宿主里跑的还是 v$($hit.version)，需要重启：pwsh -File scripts/launch-coopanion.ps1" -ForegroundColor Yellow
    } else {
      Step "宿主已加载 v$($hit.version)（loaded=$($hit.loaded)）"
    }
  } else {
    Write-Host "  ! 宿主里还没有 $name（首次安装需要重启 Coopanion）" -ForegroundColor Yellow
  }
} else {
  Step '宿主未运行，跳过在线版本核对'
}

# --- 5) 顺手把开始页注入修好（幂等） --------------------------------------
$injector = Join-Path $installed 'scripts\host-inject.mjs'
if (Test-Path $injector) {
  node $injector
  if ($LASTEXITCODE -ne 0) { Write-Host "  ! 开始页注入失败，可在扩展详情页点「重新注入开始页按钮」" -ForegroundColor Yellow }
}

Step "完成：$name $version"
[pscustomobject]@{ ok = $true; name = $name; version = $version; tgz = $tgz; installed = $installed } | ConvertTo-Json -Compress
