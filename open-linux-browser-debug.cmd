@echo off
setlocal

set "SSH_TARGET=root@49.51.51.120"
set "LOCAL_PORT=6080"
set "REMOTE_PORT=6080"
set "NOVNC_URL=http://127.0.0.1:6080/vnc.html?autoconnect=true&reconnect=true&reconnect_delay=1000&resize=scale"

where ssh.exe >nul 2>nul
if errorlevel 1 (
    echo [MercuryPro] Windows OpenSSH was not found.
    echo Install "OpenSSH Client" in Windows Optional Features and try again.
    pause
    exit /b 1
)

echo [MercuryPro] Opening SSH tunnel to %SSH_TARGET% ...
echo [MercuryPro] Enter the root password in the new window if prompted.
echo [MercuryPro] Keep that window open while using the browser debugger.

start "MercuryPro SSH Tunnel" cmd.exe /k "ssh.exe -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L %LOCAL_PORT%:127.0.0.1:%REMOTE_PORT% %SSH_TARGET%"

echo [MercuryPro] Waiting for local port %LOCAL_PORT% ...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$deadline=(Get-Date).AddSeconds(120); while((Get-Date)-lt $deadline) { if(Test-NetConnection -ComputerName 127.0.0.1 -Port %LOCAL_PORT% -InformationLevel Quiet -WarningAction SilentlyContinue) { Start-Process '%NOVNC_URL%'; exit 0 }; Start-Sleep -Seconds 1 }; exit 1"

if errorlevel 1 (
    echo [MercuryPro] The SSH tunnel was not ready within 120 seconds.
    echo Check the SSH window for a password, host-key, or connection error.
    pause
    exit /b 1
)

echo [MercuryPro] noVNC opened in your default browser.
echo [MercuryPro] Close the "MercuryPro SSH Tunnel" window to disconnect.
timeout /t 5 >nul
endlocal
