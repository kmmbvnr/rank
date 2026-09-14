# Run from the repository root after npm run build: vhs docs/demo.tape
Output docs/demo.gif

Require node
Set Shell "bash"
Set Width 880
Set Height 460
Set FontSize 23
Set FontFamily "Menlo"
Set Theme "Catppuccin Mocha"
Set Padding 20
Set Framerate 15
Set TypingSpeed 45ms

Hide
Type "node packages/cli/bin/cli.js"
Enter
Sleep 1s
Type "use sequences"
Enter
Sleep 800ms
Type "use numbers"
Enter
Sleep 800ms
Show

# Start small: inspect the stream, then sum its even terms.
Type "Limit = 100"
Enter
Sleep 500ms
Type "Fib = fibonacci to Limit"
Enter
Sleep 1s
Type "Fib even sum"
Enter
Sleep 2s

# Edit the earlier limit and rerun to solve Project Euler #2.
Up 3
Ctrl+E
Backspace 3
Type "4000000"
Sleep 1s
Ctrl+R
Sleep 4s
