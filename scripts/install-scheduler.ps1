# 업비트 스캐너 작업 스케줄러 등록 (반등 09:00/21:00 · 모멘텀 09:02/21:02 · 주간 일 22:00 · 자금유입 3시간(xx:05), KST)
# 사용법:
#   등록:   powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1
#   제거:   powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1 -Uninstall
param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$monitor = Join-Path $projectRoot 'scripts\monitor.mjs'
$momentum = Join-Path $projectRoot 'scripts\momentum-scan.mjs'
$trend = Join-Path $projectRoot 'scripts\trend-journal.mjs'
$flow = Join-Path $projectRoot 'scripts\flow-scan.mjs'
$nodePath = (Get-Command node).Source

# 반등(monitor) 09:00/21:00 → 모멘텀 09:02/21:02 → 추이저널 09:17/21:17 순차
$tasks = @(
  @{ Name = 'UpbitMonitor_0900';  Time = '09:00'; Script = $monitor },
  @{ Name = 'UpbitMonitor_2100';  Time = '21:00'; Script = $monitor },
  @{ Name = 'UpbitMomentum_0902'; Time = '09:02'; Script = $momentum },
  @{ Name = 'UpbitMomentum_2102'; Time = '21:02'; Script = $momentum },
  @{ Name = 'UpbitTrend_0917';    Time = '09:17'; Script = $trend },
  @{ Name = 'UpbitTrend_2117';    Time = '21:17'; Script = $trend },
  @{ Name = 'UpbitFlow_0005'; Time = '00:05'; Script = $flow },
  @{ Name = 'UpbitFlow_0305'; Time = '03:05'; Script = $flow },
  @{ Name = 'UpbitFlow_0605'; Time = '06:05'; Script = $flow },
  @{ Name = 'UpbitFlow_0905'; Time = '09:05'; Script = $flow },
  @{ Name = 'UpbitFlow_1205'; Time = '12:05'; Script = $flow },
  @{ Name = 'UpbitFlow_1505'; Time = '15:05'; Script = $flow },
  @{ Name = 'UpbitFlow_1805'; Time = '18:05'; Script = $flow },
  @{ Name = 'UpbitFlow_2105'; Time = '21:05'; Script = $flow }
)

if ($Uninstall) {
  foreach ($name in @($tasks.Name + 'UpbitWeekly_Sun')) {
    try { Unregister-ScheduledTask -TaskName $name -Confirm:$false; Write-Host "제거됨: $name" }
    catch { Write-Host "없음: $name" }
  }
  return
}

foreach ($t in $tasks) {
  $action = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$($t.Script)`"" -WorkingDirectory $projectRoot
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
