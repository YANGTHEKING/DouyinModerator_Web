@echo off
chcp 65001 >nul
setlocal
set "ROOT=%~dp0"
set "EXT_DIR=%ROOT%xiaoguang-ray-moderator-v0.1.0-unpacked"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
set "CHROME_X86=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "EDGE_64=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if exist "%EXT_DIR%" start "" "%EXT_DIR%"
if exist "%ROOT%使用说明.html" start "" "%ROOT%使用说明.html"

if exist "%CHROME%" (
  start "" "%CHROME%" "chrome://extensions/"
) else if exist "%CHROME_X86%" (
  start "" "%CHROME_X86%" "chrome://extensions/"
) else if exist "%EDGE%" (
  start "" "%EDGE%" "edge://extensions/"
) else if exist "%EDGE_64%" (
  start "" "%EDGE_64%" "edge://extensions/"
) else (
  start "" "chrome://extensions/"
)

echo.
echo 已打开插件文件夹和扩展管理页。
echo 在扩展页打开“开发者模式”，点击“加载已解压的扩展程序”，选择：
echo %EXT_DIR%
echo.
pause
