# Upbit scanner Task Scheduler registration -- 3-hour full pipeline (KST)
# Every 3h (00 03 06 09 12 15 18 21): monitor xx:00 -> momentum xx:02 -> flow xx:05 -> trend xx:17
# Weekly analysis Sun 22:00. WakeToRun + powercfg wake timer wakes PC from sleep (full shutdown still cannot run).
# Usage:
#   install:   powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1
#   uninstall: powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1 -Uninstall
param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node).Source

# 3-hour slots (KST = local time)
$hours = @('00','03','06','09','12','15','18','21')

# per-script minute offset within slot -- sequential ordering
$jobs = @(
  @{ Name = 'UpbitMonitor';  Script = 'monitor.mjs';       Min = '00' },
  @{ Name = 'UpbitMomentum'; Script = 'momentum-scan.mjs'; Min = '02' },
  @{ Name = 'UpbitFlow';     Script = 'flow-scan.mjs';      Min = '05' },
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

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -DontStopOnIdleEnd

# capture stdout/stderr per task -> data\task-logs\<Name>.log (so intermittent failures leave evidence)
$logDir = Join-Path $projectRoot 'data\task-logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# wrap node in cmd /c so output can be appended to a log file (prefix each line via node, kept simple here)
function New-LoggingAction([string]$scriptPath, [string]$logName) {
  $log = Join-Path $logDir "$logName.log"
  $inner = "`"$nodePath`" `"$scriptPath`" 1>> `"$log`" 2>&1"
  New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$inner`"" -WorkingDirectory $projectRoot
}

foreach ($j in $jobs) {
  $script = Join-Path $projectRoot "scripts\$($j.Script)"
  $action = New-LoggingAction $script $j.Name
  $triggers = foreach ($h in $hours) { New-ScheduledTaskTrigger -Daily -At "$($h):$($j.Min)" }
  Register-ScheduledTask -TaskName $j.Name -Action $action -Trigger $triggers -Settings $settings -Force | Out-Null
  Write-Host "registered: $($j.Name) @ every 3h xx:$($j.Min) (8/day)"
}

# weekly analysis: Sunday 22:00
$weekly = Join-Path $projectRoot 'scripts\weekly-analysis.mjs'
$wAction = New-LoggingAction $weekly 'UpbitWeekly_Sun'
$wTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '22:00'
Register-ScheduledTask -TaskName 'UpbitWeekly_Sun' -Action $wAction -Trigger $wTrigger -Settings $settings -Force | Out-Null
Write-Host "registered: UpbitWeekly_Sun @ Sun 22:00"

Write-Host "`nverify: Get-ScheduledTask -TaskName 'Upbit*'"