!include "getProcessInfo.nsh"
Var typealotPid

!macro customInstall
  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    ; Repair missing links on upgrades too; keep the desktop shortcut preference intact.
    Delete "$newStartMenuLink"
    StrCpy $keepShortcuts "false"
    !insertmacro addStartMenuLink $keepShortcuts
    ; Notify the shell even when a link already existed but was absent from the app list.
    System::Call 'shell32::SHChangeNotify(i 0x00000002, i 0x0005, w "$newStartMenuLink", p 0)'
    System::Call 'shell32::SHChangeNotify(i 0x00001000, i 0x0005, w "$SMPROGRAMS", p 0)'
  !endif
!macroend

!macro customCheckAppRunning
  ; Match the executable name, never every process under $INSTDIR (including setup itself).
  ${GetProcessInfo} 0 $typealotPid $1 $2 $3 $4
  ${if} $3 == "${APP_EXECUTABLE_FILENAME}"
    SetErrorLevel 2
    Quit
  ${endif}

  StrCpy $R1 0
  typealot_check:
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 == 603
      Goto typealot_not_running
    ${elseif} $R0 != 0
      ; An enumeration failure must not be treated as either a running app or an empty list.
      ${if} $LANGUAGE == 1049
        MessageBox MB_OK|MB_ICONSTOP "Не удалось проверить процессы ${PRODUCT_NAME} (код $R0). Установка остановлена." /SD IDOK
      ${else}
        MessageBox MB_OK|MB_ICONSTOP "Could not check ${PRODUCT_NAME} processes (code $R0). Installation stopped." /SD IDOK
      ${endif}
      SetErrorLevel 2
      Quit
    ${endif}

    ${if} $R1 == 0
      ${ifNot} ${isUpdated}
        MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK typealot_close
        SetErrorLevel 2
        Quit
      ${endif}
      typealot_close:
      ; Without /F, Windows requests a normal close so the renderer can save its workspace.
      nsExec::Exec '"$SYSDIR\taskkill.exe" /IM "${APP_EXECUTABLE_FILENAME}" /FI "PID ne $typealotPid"'
      Pop $R0
    ${endif}

    IntOp $R1 $R1 + 1
    ${if} $R1 <= 40
      Sleep 500
      Goto typealot_check
    ${endif}

    ; Do not force termination while Typealot may be saving or showing a save error.
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY typealot_retry
    SetErrorLevel 2
    Quit
    typealot_retry:
      StrCpy $R1 0
      Goto typealot_check

  typealot_not_running:
    ${nsProcess::Unload}
!macroend
