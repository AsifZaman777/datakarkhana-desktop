$WshShell = New-Object -comObject WScript.Shell
$DesktopPath = [System.Environment]::GetFolderPath('Desktop')
$Shortcut = $WshShell.CreateShortcut("$DesktopPath\DataKarkhana Desktop.lnk")
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$Shortcut.TargetPath = "wscript.exe"
$Shortcut.Arguments = "`"$ScriptDir\DataKarkhana.vbs`""
$Shortcut.WorkingDirectory = $ScriptDir
$Shortcut.IconLocation = "$ScriptDir\icon.ico"
$Shortcut.Description = "DataKarkhana Desktop — Local Automation & Lead Generation Engine"
$Shortcut.WindowStyle = 7
$Shortcut.Save()

Write-Host "DataKarkhana Desktop icon successfully created on your Desktop!" -ForegroundColor Green
