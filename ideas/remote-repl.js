try {
const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;
const Cr = Components.results;

const { console } =  Cu.import("resource://gre/modules/devtools/Console.jsm", {});
const { devtools } = Cu.import("resource://gre/modules/devtools/Loader.jsm", {});
const { esprimaWithSweet: parser } =
      Cu.import("file:///Users/james/projects/mozilla/gecko-dev/devrepl/parser.js", {});
const { debuggerSocketConnect, DebuggerClient } =
      Cu.import("resource://gre/modules/devtools/dbg-client.jsm", {});

  
// REPL

let _currentModule = '';
let _currentRepl = 0;
let _paused = false;

function startRepl(threadClient) {
  let done = false;
  _currentRepl++;

  while(!done) {
    var msg = '';
    if(_currentModule) {
      msg = '...' + _currentModule.slice(_currentModule.length-30);
    }
    if(_currentRepl > 1) {
      msg += 'paused';
    }
    dump(msg + '> ');
    var expr = readline();
    var firstWord = expr.split(' ')[0];

    switch(firstWord) {
    case ',quit':
      done = true; break;
    case ',pump':
      if(threadClient.paused) {
        print("cannot pump when thread is paused");
        break;
      }
      done = true;
      setTimeout(startRepl.bind(this, threadClient), 0);
      break;
    case ',resume':
      done = true;
      threadClient.resume(() => {});
      break;
    case ',sources':
      threadClient.getSources(function(res) {
        res.sources.forEach(function(source, i) {
          print('[' + i + '] ' + source.url);
        });
      });
      break;
    case ',threadstate':
      print(threadClient.state);
      break;
    case ',open':
      var module = expr.split(' ')[1];
      var idx = parseInt(module);
      if(idx) {
        module = getModules()[idx];
      }

      sandbox = getSandbox(module);
      _currentModule = module;
      break;
    case ',close':
      sandbox = gSandbox;
      _currentModule = '';
      break;
    default:
      let validInput;
      do {
        try {
          parser.read(expr);
          validInput = true;
        }
        catch(e) {
          validInput = false;
        }

        if(!validInput) {
          dump('... ');
          expr += '\n' + readline();
        }
      } while(!validInput);

      // Add the pause listener here so that it is run last; any
      // listeners added by the client will be run (we can't do
      // anything afterwards because the thread is paused)
      function onPaused() {
        startRepl(threadClient);
      }
      threadClient.addListener("paused", onPaused);

      try {        
        let res = Cu.evalInSandbox(
          expr, sandbox, "1.8",
          _currentModule || "global"
        );
        if(res !== undefined) {
          print(res);
        }
      }
      catch(e) {
        print(String(e));
      }

      threadClient.removeListener("paused", onPaused);
    }
  }

  _currentRepl--;
}

let transport = debuggerSocketConnect('localhost', '5200');
let client = new DebuggerClient(transport);
client.connect(() => {
  console.log('connected');
    
  client.listTabs((res) => {
    console.log(res);
    var chromeDebugger = res.chromeDebugger;

    client.attachThread(chromeDebugger, (res, threadClient) => {
      threadClient.resume(() => {
        startRepl(threadClient);
      });
    });
  });
});

let _quit = false;
function startEventLoop() {
  var thr = Components.classes["@mozilla.org/thread-manager;1"]
                      .getService().currentThread;

  while (!_quit)
    thr.processNextEvent(true);

  while (thr.hasPendingEvents())
    thr.processNextEvent(true);
}

startEventLoop();

} catch(e) { print(String(e)); }
