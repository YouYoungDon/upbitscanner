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
  foreach ($t in $tasks) {
    try { Unregister-ScheduledTask -TaskName $t.Name -Confirm:$false; Write-Host "제거됨: $($t.Name)" }
    catch { Write-Host "없음: $($t.Name)" }
  }
  return
}

foreach ($t in $tasks) {
  $action = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$monitor`"" -WorkingDirectory $projectRoot
  $trigger = New-ScheduledTaskTrigger -Daily -At $t.Time
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd
  Register-ScheduledTask -TaskName $t.Name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Write-Host "등록됨: $($t.Name) @ $($t.Time) (로컬 시간 = KST)"
}
Write-Host "`n확인: Get-ScheduledTask -TaskName 'UpbitMonitor_*'"
