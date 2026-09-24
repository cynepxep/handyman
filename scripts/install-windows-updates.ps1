$ErrorActionPreference = "Stop"
$session = New-Object -ComObject Microsoft.Update.Session
$found = $session.CreateUpdateSearcher().Search("IsInstalled=0 and Type='Software'").Updates
if ($found.Count -eq 0) { Write-Host "No updates found."; exit 0 }

$coll = New-Object -ComObject Microsoft.Update.UpdateColl
foreach ($u in $found) {
  Write-Host ("Queued: " + $u.Title)
  if (-not $u.EulaAccepted) { $u.AcceptEula() }
  [void]$coll.Add($u)
}

Write-Host "Downloading (this can take 10-30 minutes)..."
$dl = $session.CreateUpdateDownloader()
$dl.Updates = $coll
$dr = $dl.Download()
Write-Host ("Download result code: " + $dr.ResultCode + "  (2 = OK)")

Write-Host "Installing (do not turn off the computer)..."
$inst = $session.CreateUpdateInstaller()
$inst.Updates = $coll
$ir = $inst.Install()
Write-Host ("Install result code: " + $ir.ResultCode + "  (2 = OK, 3 = OK with warnings)")
Write-Host ("Reboot required: " + $ir.RebootRequired)
