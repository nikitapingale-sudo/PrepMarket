# Registers (or removes) a Windows Scheduled Task that refreshes the banner
# click data on the live dashboard every 3 hours.
#
# Vercel cannot reach Trino - the host is a private 10.x address - so the query
# has to run on a machine inside the corporate network. This task does exactly
# what "npm run publish-clicks" does, on a timer.
#
#   Install :  powershell -ExecutionPolicy Bypass -File dev\schedule-clicks.ps1
#   Remove  :  powershell -ExecutionPolicy Bypass -File dev\schedule-clicks.ps1 -Remove
#   Status  :  powershell -ExecutionPolicy Bypass -File dev\schedule-clicks.ps1 -Status

param(
    [switch]$Remove,
    [switch]$Status,
    # Three fixed runs a day rather than a rolling interval: predictable times
    # a team can rely on - before the day starts, midday, and after close.
    [string[]]$At = @("08:00", "14:00", "20:00")
)

$TaskName = "PrepMarket - Refresh Banner Clicks"
$Project  = Split-Path -Parent $PSScriptRoot
$LogFile  = Join-Path $Project "dev\sync-clicks.log"

if ($Remove) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Output "Removed scheduled task: $TaskName"
    } else {
        Write-Output "No such scheduled task."
    }
    return
}

if ($Status) {
    $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $t) { Write-Output "Not installed."; return }
    $i = Get-ScheduledTaskInfo -TaskName $TaskName
    Write-Output "Task      : $TaskName"
    Write-Output "State     : $($t.State)"
    Write-Output "Last run  : $($i.LastRunTime)  (result $($i.LastTaskResult))"
    Write-Output "Next run  : $($i.NextRunTime)"
    Write-Output "Log       : $LogFile"
    return
}

# npm is a .cmd shim, so it must be invoked through cmd.exe
$cmd = "/c cd /d `"$Project`" && npm run publish-clicks >> `"$LogFile`" 2>&1"

# `powershell -File script.ps1 -At '09:00','12:00'` arrives as ONE string
# "09:00,12:00", which New-ScheduledTaskTrigger cannot parse. Split it back out.
$times = @($At | ForEach-Object { $_ -split '\s*,\s*' } | Where-Object { $_ })

$parsed = @()
foreach ($t in $times) {
    try { $parsed += [datetime]::ParseExact($t.Trim(), 'HH:mm', $null) }
    catch { Write-Error "Not a valid 24-hour time: '$t'. Use HH:mm, e.g. 09:00."; exit 1 }
}

$action    = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $cmd -WorkingDirectory $Project
# one daily trigger per requested time
$trigger   = @($parsed | ForEach-Object { New-ScheduledTaskTrigger -Daily -At $_ })
# Run only when a network is available, and don't fight the battery saver -
# a missed run simply catches up on the next one.
$settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable `
                -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
                -MultipleInstances IgnoreNew `
                -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

try {
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
        -Settings $settings -Description "Runs the Trino banner-click and funnel queries, then publishes the result to the PrepMarket dashboard." `
        -Force -ErrorAction Stop | Out-Null
} catch {
    Write-Error "Could not register the task: $($_.Exception.Message)"
    exit 1
}

# Never report success without confirming it - an earlier version printed
# "Installed" even when registration had failed, leaving no job scheduled.
$check = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $check -or $check.Triggers.Count -ne $parsed.Count) {
    Write-Error "Registration did not stick: expected $($parsed.Count) triggers, found $($check.Triggers.Count)."
    exit 1
}

Write-Output "Installed: $TaskName"
Write-Output "  runs daily at: $(($parsed | ForEach-Object { $_.ToString('HH:mm') }) -join ', ')"
Write-Output "  project : $Project"
Write-Output "  log     : $LogFile"
Write-Output ""
Write-Output "Change times: ... schedule-clicks.ps1 -At '07:00','13:00','19:00'"
Write-Output "Remove with:  powershell -ExecutionPolicy Bypass -File dev\schedule-clicks.ps1 -Remove"
