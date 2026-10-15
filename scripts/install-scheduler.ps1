# Upbit scanner Task Scheduler registration -- 3-hour full pipeline (KST)
# Every 3h (00 03 06 09 12 15 18 21): monitor xx:00 -> momentum xx:02 -> trend xx:17
# (UpbitFlow 5-minute money-flow scan removed 2026-10-08: no edge as accumulation signal; see scripts/research/accumulation)
# Daily scorecard batch 09:10 (scores matured pick episodes +1/+3/+7d).
# Weekly analysis Sun 22:00. WakeToRun + powercfg wake timer wakes PC from sleep (full shutdown still cannot run).
# Tasks run as S4U ("run whether user is logged on or not"): on 2026-10-15 a Windows Update restart at 02:45
# left the PC at the login screen until 08:22 and every Interactive task (scans, paper, bot, news) stood still.
# S4U tasks run at the login screen too. Registering S4U needs an elevated (admin) PowerShell.
# Usage (elevated):
#   install:   powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1
#   uninstall: powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1 -Uninstall
param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw 'run from an elevated (admin) PowerShell: S4U task registration needs admin' }
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node).Source

# 3-hour slots (KST = local time)
$hours = @('00','03','06','09','12','15','18','21')

# per-script minute offset within slot -- sequential ordering
$jobs = @(
  @{ Name = 'UpbitMonitor';  Script = 'monitor.mjs';       Min = '00' },
  @{ Name = 'UpbitMomentum'; Script = 'momentum-scan.mjs'; Min = '02' },
  @{ Name = 'UpbitTrend';    Script = 'trend-journal.mjs';  Min = '17' }
)

# wipe ALL existing Upbit* tasks first (removes old per-time tasks, avoids orphans)
Get-ScheduledTask -TaskName 'Upbit*' -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false
Write-Host "cleared existing Upbit* tasks"

if ($Uninstall) { Write-Host "uninstall complete"; return }

# power: allow wake timers (AC/DC) so WakeToRun actually fires
try {
  powercfg -SETACVALUEINDEX SCHEME_CURRENT SUB_SLEEP RTCWAKE 1 | Out-Null
  powercfg -SETDCVALUEINDEX SCHEME_CURRENT SUB_SLEEP RTCWAKE 1 | Out-Null
  powercfg -SETACTIVE SCHEME_CURRENT | Out-Null
  Write-Host "wake timers enabled (AC/DC)"
} catch { Write-Host "wake timer step skipped: $_" }

# Windows Update active hours 15:00-09:00 (18h, the maximum): automatic restarts only happen 09:00-15:00,
# not overnight. SmartActiveHoursState=0 keeps Windows from moving the window on its own.
try {
  $ux = 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings'
  Set-ItemProperty -Path $ux -Name SmartActiveHoursState -Value 0 -Type DWord
  Set-ItemProperty -Path $ux -Name ActiveHoursStart -Value 15 -Type DWord
  Set-ItemProperty -Path $ux -Name ActiveHoursEnd -Value 9 -Type DWord
  Write-Host "windows update active hours: 15:00-09:00 (restarts only 09:00-15:00)"
} catch { Write-Host "active hours step skipped: $_" }

# ExecutionTimeLimit 15min: default is 72H, which lets a phantom 'Running' zombie
# block all subsequent runs (IgnoreNew) for days. 15min lets a hang self-clear fast.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

# capture stdout/stderr per task -> data\task-logs\<Name>.log (so intermittent failures leave evidence)
$logDir = Join-Path $projectRoot 'data\task-logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# Run windowless: conhost --headless -> node scripts\run-logged.mjs <script> <log> (appends stdout/stderr).
# Was 'cmd /c node ... 1>> log', but on Windows 11 that opens a visible Windows Terminal window, and closing
# it killed the always-on bot with Ctrl+C (0xC000013A, 2026-10-08). conhost mangles cmd's nested quotes,
# so the log redirect lives in run-logged.mjs instead of cmd.
$runner = Join-Path $projectRoot 'scripts\run-logged.mjs'
function New-LoggingAction([string]$scriptPath, [string]$logName) {
  $log = Join-Path $logDir "$logName.log"
  New-ScheduledTaskAction -Execute 'conhost.exe' -Argument "--headless `"$nodePath`" `"$runner`" `"$scriptPath`" `"$log`"" -WorkingDirectory $projectRoot
}

foreach ($j in $jobs) {
  $script = Join-Path $projectRoot "scripts\$($j.Script)"
  $action = New-LoggingAction $script $j.Name
  $triggers = foreach ($h in $hours) { New-ScheduledTaskTrigger -Daily -At "$($h):$($j.Min)" }
  Register-ScheduledTask -TaskName $j.Name -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Force | Out-Null
  Write-Host "registered: $($j.Name) @ every 3h xx:$($j.Min) (8/day)"
}

# weekly analysis: Sunday 22:00
$weekly = Join-Path $projectRoot 'scripts\weekly-analysis.mjs'
$wAction = New-LoggingAction $weekly 'UpbitWeekly_Sun'
$wTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '22:00'
Register-ScheduledTask -TaskName 'UpbitWeekly_Sun' -Action $wAction -Trigger $wTrigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "registered: UpbitWeekly_Sun @ Sun 22:00"

# daily scorecard batch: 09:10 (after the 09:00-09:05 morning scan matures, scores +1/+3/+7d pick episodes)
$scorecard = Join-Path $projectRoot 'scripts\scorecard.mjs'
$scAction = New-LoggingAction $scorecard 'UpbitScorecard'
$scTrigger = New-ScheduledTaskTrigger -Daily -At '09:10'
Register-ScheduledTask -TaskName 'UpbitScorecard' -Action $scAction -Trigger $scTrigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "registered: UpbitScorecard @ daily 09:10"

# paper trading: hourly xx:10 (checks SL/TP on 1h candles, enters the newest scan picks at live orderbook prices)
$paper = Join-Path $projectRoot 'scripts\paper-trade.mjs'
$pAction = New-LoggingAction $paper 'UpbitPaper'
$pTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddMinutes(10) -RepetitionInterval (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName 'UpbitPaper' -Action $pAction -Trigger $pTrigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "registered: UpbitPaper @ hourly xx:10"

# always-on Telegram bot: starts at boot (answers lookup commands), independent of scan tasks
$botScript = Join-Path $projectRoot 'scripts\telegram-bot.mjs'
$botAction = New-LoggingAction $botScript 'UpbitTelegramBot'
# daemon auto-recovery: RestartInterval only retries a failed START, it does not revive a process that died
# while running (2026-10-08 bot and news daemon were down 3h after a Ctrl+C exit). A 5-minute watchdog
# trigger with IgnoreNew does nothing while alive and restarts within 5 minutes when dead.
$watchdogTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 5)
$botTrigger = @((New-ScheduledTaskTrigger -AtStartup), $watchdogTrigger)
$botSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 999 -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'UpbitTelegramBot' -Action $botAction -Trigger $botTrigger -Settings $botSettings -Principal $principal -Force | Out-Null
Write-Host "registered: UpbitTelegramBot (AtStartup + 5min watchdog, always-on)"

# always-on news/notice watch daemon: starts at boot, same recovery settings as the bot
$newsScript = Join-Path $projectRoot 'scripts\news-watch.mjs'
$newsAction = New-LoggingAction $newsScript 'UpbitNewsWatch'
$newsTrigger = @((New-ScheduledTaskTrigger -AtStartup), $watchdogTrigger)
Register-ScheduledTask -TaskName 'UpbitNewsWatch' -Action $newsAction -Trigger $newsTrigger -Settings $botSettings -Principal $principal -Force | Out-Null
Write-Host "registered: UpbitNewsWatch (AtStartup + 5min watchdog, always-on)"

# always-on dashboard web server (http://127.0.0.1:8787): same boot start + watchdog as the daemons.
# Runs in session 0 under S4U; loopback is shared across sessions so the browser still reaches it.
$dashScript = Join-Path $projectRoot 'server\server.mjs'
$dashAction = New-LoggingAction $dashScript 'UpbitDashboard'
$dashTrigger = @((New-ScheduledTaskTrigger -AtStartup), $watchdogTrigger)
Register-ScheduledTask -TaskName 'UpbitDashboard' -Action $dashAction -Trigger $dashTrigger -Settings $botSettings -Principal $principal -Force | Out-Null
Write-Host "registered: UpbitDashboard (AtStartup + 5min watchdog, always-on)"

Write-Host "`nverify: Get-ScheduledTask -TaskName 'Upbit*'"