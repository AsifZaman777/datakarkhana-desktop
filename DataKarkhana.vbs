' ====================================================================
' DATAKARKHANA DESKTOP — SILENT WINDOWS LAUNCHER
' Launches the Desktop application with ZERO command prompt / terminal windows
' ====================================================================
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = scriptDir

' Run npm start / electron completely invisible (0 = SW_HIDE, False = don't wait)
WshShell.Run "cmd /c npm start", 0, False

Set WshShell = Nothing
Set fso = Nothing
