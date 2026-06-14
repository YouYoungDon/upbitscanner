# 업비트 스캐너 작업 스케줄러 등록 (매일 KST 09:00 / 21:00)
# 사용법:
#   등록:   powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1
#   제거:   powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1 -Uninstall
param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$monitor = Join-Path $projectRoot 'scripts\monitor.mjs'
$nodePath = (Get-Command node).Source

$tasks = @(
  @{ Name = 'UpbitMonitor_0900'; Time = '09:00' },
  @{ Name = 'UpbitMonitor_2100'; Time = '21:00' }
)

if ($Uninstall) {
  foreach ($name in @($tasks.Name + 'UpbitWeekly_Sun')) {
    try { Unregister-ScheduledTask -TaskName $name -Confirm:$false; Write-Host "제거됨: $name" }
    catch { Write-Host "없음: $name" }
  }
  return
}

foreach ($t in $tasks) {
  $action = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$monitor`"" -WorkingDirectory $projectRoot
  $trigger = New-ScheduledTaskTrigger -Daily -At $t.Time
  # WakeToRun: 절전 중이면 PC를 깨워 실행 / 배터리에서도 시작·유지 / 놓친 작업은 깨어난 뒤 실행
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -DontStopOnIdleEnd
  Register-ScheduledTask -TaskName $t.Name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Write-Host "등록됨: $($t.Name) @ $($t.Time) (로컬 시간 = KST)"
}

# 주간 분석: 매주 일요일 22:00 (일일 스캔 21:00 종료 후)
$weekly = Join-Path $projectRoot 'scripts\weekly-analysis.mjs'
$wAction = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$weekly`"" -WorkingDirectory $projectRoot
$wTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '22:00'
$wSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -DontStopOnIdleEnd
Register-ScheduledTask -TaskName 'UpbitWeekly_Sun' -Action $wAction -Trigger $wTrigger -Settings $wSettings -Force | Out-Null
Write-Host "등록됨: UpbitWeekly_Sun @ Sun 22:00 (로컬 시간 = KST)"

Write-Host "`n확인: Get-ScheduledTask -TaskName 'Upbit*'"
