!macro customInstall
  WriteRegStr HKCU "Software\Classes\Directory\shell\SuperBash" "" "Open with Super Bash"
  WriteRegStr HKCU "Software\Classes\Directory\shell\SuperBash" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "Software\Classes\Directory\shell\SuperBash\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --open-dir "%1"'

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\SuperBash" "" "Open with Super Bash"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\SuperBash" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\SuperBash\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --open-dir "%V"'

  WriteRegStr HKCU "Software\Classes\Drive\shell\SuperBash" "" "Open with Super Bash"
  WriteRegStr HKCU "Software\Classes\Drive\shell\SuperBash" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "Software\Classes\Drive\shell\SuperBash\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --open-dir "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\Directory\shell\SuperBash"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\SuperBash"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\SuperBash"
!macroend
