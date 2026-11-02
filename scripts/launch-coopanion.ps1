#!/usr/bin/env pwsh
<#
.SYNOPSIS
  干净地启动 Coopanion：清掉 ELECTRON_RUN_AS_NODE，拉起主窗口，等 core HTTP 就绪后报到。

.DESCRIPTION
  为什么需要这个脚本：如果当前终端/进程树里残留 ELECTRON_RUN_AS_NODE=1（比如跑 node 子进程时设的），
  任何从这里 `Start-Process` 出去的 Electron 程序都会以 **Node 模式**启动——窗口不出现、`--version`
  打印 node 版本号，看起来像「二进制坏了」。这不是 Coopanion 的缺陷，是环境变量继承。

  本脚本做四件事：
    1. 清掉 ELECTRON_RUN_AS_NODE（只影响本进程树，不改用户/机器环境变量）；
    2. 启动 Coopanion.exe；
    3. 轮询 http://127.0.0.1:<port>/api/status 直到就绪（默认最多 60 秒）；
    4. 打印主进程 pid、端口、扩展/World 概览；失败时给出可读原因。

.PARAMETER Port
  core HTTP 端口，默认 17788（companion 配置里的 web.port 起点）。

.PARAMETER TimeoutSeconds
  等待就绪的上限，默认 60。

.PARAMETER ExePath
  Coopanion.exe 的路径，默认按 %LOCALAPPDATA% 和 %PROGRAMFILES% 探测。

.PARAMETER Quiet
  只输出最终结果行。

.EXAMPLE
  pwsh -File scripts/launch-coopanion.ps1
#>
[CmdletBinding()]
param(
  [int]$Port = 17788,
  [int]$TimeoutSeconds = 60,
  [string]$ExePath = '',
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
function Say([string]$msg) { if (-not $Quiet) { Write-Host $msg } }

# 1) 清环境变量（关键一步；只改本进程，不动用户/机器级设置）
$previous = $env:ELECTRON_RUN_AS_NODE
if ($previous) { Say "· 检测到残留 ELECTRON_RUN_AS_NODE=$previous，已在本进程清除" }
$env:ELECTRON_RUN_AS_NODE = $null
# 有些终端会用 === 或空串占位，一并清掉
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

# 2) 找 exe
if (-not $ExePath) {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Coopanion\Coopanion.exe'),
    (Join-Path $env:ProgramFiles 'Coopanion\Coopanion.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Coopanion\Coopanion.exe')
  ) | Where-Object { $_ -and (Test-Path $_) }
  $ExePath = $candidates | Select-Object -First 1
}
if (-not $ExePath -or -not (Test-Path $ExePath)) {
  Write-Error "找不到 Coopanion.exe；用 -ExePath 指定绝对路径。"
  exit 2
}
Say "· 可执行文件：$ExePath"

# 3) 已经跑着就不重复拉（二次实例会因 singleInstanceLock 立刻退出）
$running = Get-Process Coopanion -ErrorAction SilentlyContinue
if ($running) {
  Say "· 已有 $($running.Count) 个 Coopanion 进程在跑，跳过启动"
} else {
  # 用 Start-Process 在干净环境里拉起（本进程已清过变量，子进程不会继承）
  Start-Process -FilePath $ExePath -WorkingDirectory (Split-Path $ExePath) | Out-Null
  Say '· 已发出启动命令，等待 core 就绪…'
}

# 4) 等 core HTTP 就绪
$base = "http://127.0.0.1:$Port"
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$ready = $false
$lastErr = ''
while ((Get-Date) -lt $deadline) {
  try {
    $null = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "$base/api/status"
    $ready = $true
    break
  } catch {
    $lastErr = $_.Exception.Message
    Start-Sleep -Milliseconds 700
  }
}

if (-not $ready) {
  $procs = Get-Process Coopanion -ErrorAction SilentlyContinue
  Write-Error "等待 $TimeoutSeconds 秒仍未就绪（$base/api/status）。进程数=$($procs.Count)；最后错误：$lastErr`n" +
    "排查：若进程数为 0，确认没有残留 ELECTRON_RUN_AS_NODE；若进程数>0，看 <data>\logs\core.log。"
  exit 3
}

# 5) 报到
$pid_ = (Get-Process Coopanion -ErrorAction SilentlyContinue | Sort-Object StartTime | Select-Object -First 1).Id
$ext = $null; $worlds = $null
try { $ext = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "$base/api/extensions").Content | ConvertFrom-Json } catch {}
try { $worlds = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "$base/api/worlds").Content | ConvertFrom-Json } catch {}

$wbExt = $ext.extensions | Where-Object { $_.name -eq 'cortico-world-workbuddy' } | Select-Object -First 1
$wbWorld = $worlds.worlds | Where-Object { $_.id -eq 'workbuddy' } | Select-Object -First 1

Say ''
Say "就绪：$base （主进程 pid $pid_）"
if ($wbExt) { Say (" · 扩展 {0} v{1} loaded={2}" -f $wbExt.name, $wbExt.version, $wbExt.loaded) }
if ($wbWorld) {
  Say (" · World workbuddy status={0}，工具：{1}" -f $wbWorld.status, ($wbWorld.tools -join ','))
  foreach ($lamp in $wbWorld.lamps) { Say ("     - {0} [{1}] {2}" -f $lamp.label, $lamp.state, $lamp.hint) }
}

[pscustomobject]@{
  ok = $true
  base = $base
  pid = $pid_
  version = if ($wbExt) { $wbExt.version } else { $null }
  world = if ($wbWorld) { $wbWorld.status } else { $null }
} | ConvertTo-Json -Compress
