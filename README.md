
# devrepl

A REPL for interacting with Firefox debugger client/server. More to come.

To run under emacs, just run `(run-js "/path/to/devrepl")`. Even
better, bind it to key to get instant REPL whenever you want:

```
(global-set-key
 (kbd "<f9>")
 (lambda ()
   (interactive)
   (run-js "~/projects/devrepl/devrepl")))
```

Instructions for other editors like Sublime is coming. Basically just
run the `devrepl` script though.

You can use `debugger` in code to trigger breakpoints. The REPL will
print "paused" when the thread is paused because of a breakpoint.
Better interaction here is coming.

Use a comma to run a REPL command. Available commands:

* `,quit` - quit
* `,pump` - pump the event loop (the REPL right now is on the same thread)
* `,pause` - interrupt the thread and put into paused state
* `,resume` - resume the thread (if paused, like at a breakpoint)
* `,modules` - list all the loaded modules
* `,open <module>` - open an evaluation environment inside module (takes the
  integer assigned to the module from `,modules`). all future
  evaluations will happen inside it.
* `,close` - close the current module evaluation environment and return to the global scope
* `,threadstate` - print the existing thread state
* `,global <expr>` - when inside a module eval environment, eval <expr> in the global scope instead of the module

![](http://recordit.co/B7eBV0lvjl.gif)