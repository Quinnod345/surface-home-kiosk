Option Explicit

Dim shell, fso, scriptDir, root, env
Dim bridgeExe, electronExe, command, exitCode

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
root = fso.GetParentFolderName(scriptDir)
shell.CurrentDirectory = root

Set env = shell.Environment("PROCESS")
env("SURFACE_KIOSK") = "1"
env("NODE_ENV") = "production"

bridgeExe = root & "\windows\SurfaceCameraBridge\bin\Release\net8.0-windows10.0.19041.0\win-x64\publish\SurfaceCameraBridge.exe"
electronExe = root & "\node_modules\electron\dist\electron.exe"

If fso.FileExists(bridgeExe) And Not IsProcessRunning("SurfaceCameraBridge.exe") Then
  command = """" & bridgeExe & """ serve --kind Infrared --url http://127.0.0.1:8765/"
  shell.Run command, 0, False
End If

If Not fso.FileExists(electronExe) Then
  WScript.Echo "Electron not found: " & electronExe
  WScript.Quit 2
End If

command = """" & electronExe & """ """ & root & """"
exitCode = shell.Run(command, 1, True)
WScript.Quit exitCode

Function IsProcessRunning(processName)
  Dim service, processes
  Set service = GetObject("winmgmts:\\.\root\cimv2")
  Set processes = service.ExecQuery("SELECT * FROM Win32_Process WHERE Name = '" & processName & "'")
  IsProcessRunning = (processes.Count > 0)
End Function
