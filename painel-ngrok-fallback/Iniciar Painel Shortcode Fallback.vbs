Set objShell = CreateObject("Wscript.Shell")
scriptPath = Replace(WScript.ScriptFullName, "Iniciar Painel Shortcode Fallback.vbs", "start-painel-fallback.ps1")
objShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File """ & scriptPath & """", 0, False
