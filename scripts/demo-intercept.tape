# Renders assets/pi-nobash-demo.gif from the deterministic demo driver.
# Run from the repository root:  vhs scripts/demo-intercept.tape
Output assets/pi-nobash-demo.gif

Set Shell bash
Set FontSize 14
Set Width 1040
Set Height 560
Set Padding 20
Set TypingSpeed 35ms
Set Theme "Catppuccin Mocha"

Type "node scripts/demo-intercept.ts"
Enter
Sleep 8s
