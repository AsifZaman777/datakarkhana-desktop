' ====================================================================
' DATAKARKHANA DESKTOP — SILENT WINDOWS LAUNCHER
' Launches the Desktop application with ZERO command prompt / terminal windows
' ====================================================================
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = scriptDir

' Check and run precompiled binary or local electron directly without requiring global npm
If fso.FileExists(scriptDir & "\dist\win-unpacked\DataKarkhana Desktop.exe") Then
    WshShell.Run """" & scriptDir & "\dist\win-unpacked\DataKarkhana Desktop.exe""", 1, False
ElseIf fso.FileExists(scriptDir & "\node_modules\electron\dist\electron.exe") Then
    WshShell.Run """" & scriptDir & "\node_modules\electron\dist\electron.exe"" """ & scriptDir & """", 1, False
Else
    WshShell.Run "cmd /c npm start", 0, False
End If

Set WshShell = Nothing
Set fso = Nothing
