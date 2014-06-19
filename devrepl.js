try {

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;
const Cr = Components.results;

// Load in everything we need
Cu.import("resource://gre/modules/Services.jsm");

const { devtools } = Cu.import("resource://gre/modules/devtools/Loader.jsm", {});
devtools.invisibleToDebugger = false;

const { console } =  Cu.import("resource://gre/modules/devtools/Console.jsm", {});
const { esprimaWithSweet: parser } =
    Cu.import("file:///Users/james/projects/mozilla/gecko-dev/devrepl/parser.js", {});
Cu.import("resource://gre/modules/devtools/dbg-client.jsm");
// Enable RDP connection and logging
Services.prefs.setBoolPref("devtools.debugger.log", false);
Services.prefs.setBoolPref("devtools.debugger.remote-enabled", true);

const { DebuggerServer } = devtools.require("devtools/server/main");
const { setTimeout } = devtools.require("sdk/timers");

// Utility methods

function resolvePath(path, allowNonexistent) {
  let lf = Components.classes["@mozilla.org/file/directory_service;1"]
      .getService(Components.interfaces.nsIProperties)
      .get("CurWorkD", Components.interfaces.nsILocalFile);

  let bits = path.split("/");
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) {
      if (bits[i] == "..")
        lf = lf.parent;
      else
        lf.append(bits[i]);
    }
  }

  return lf.path;
}

// Add the resource://test alias to the server tests so we can load
// the test actor

let protocolHandler =
    Services.io.getProtocolHandler("resource")
    .QueryInterface(Components.interfaces.nsIResProtocolHandler);
let aliasFile = Components.classes["@mozilla.org/file/local;1"]
    .createInstance(Components.interfaces.nsILocalFile);
aliasFile.initWithPath(resolvePath('toolkit/devtools/server/tests/unit'));
protocolHandler.setSubstitution("test",
                                Services.io.newFileURI(aliasFile));

// Configure and start the server

let CONNECTION = null;
  
DebuggerServer.setRootActor = function(func) {
  this.createRootActor = function(conn) {
    CONNECTION = conn;
    
    let root = func(conn);
    // Patch the root actor because testactors.js doesn't add this and
    // we need it for the chrome debugger
    root._parameters.globalActorFactories = DebuggerServer.globalActorFactories;
    return root;
  };
};

let { ChromeDebuggerActor } = devtools.require("devtools/server/actors/script");
DebuggerServer.addGlobalActor(ChromeDebuggerActor, "chromeDebugger");
DebuggerServer.registerModule("devtools/server/actors/script");
DebuggerServer.registerModule("xpcshell-test/testactors");
DebuggerServer.init(function() { return true; });

function getModules() {
  return Object.keys(devtools.provider.loader.sandboxes)
}

function getSandbox(module) {
  return devtools.provider.loader.sandboxes[module];
}

// Add our test sandbox (basically a fake tab)

let systemPrincipal = Cc["@mozilla.org/systemprincipal;1"]
    .createInstance(Ci.nsIPrincipal);
let gSandbox = Cu.Sandbox(systemPrincipal);
gSandbox.__name = 'devrepl';
DebuggerServer.addTestGlobal(gSandbox);

// Event loop

let _quit = false;
function startEventLoop() {
  var thr = Components.classes["@mozilla.org/thread-manager;1"]
                      .getService().currentThread;

  while (!_quit)
    thr.processNextEvent(true);

  while (thr.hasPendingEvents())
    thr.processNextEvent(true);
}

function pumpEventLoop() {
  var thr = Components.classes["@mozilla.org/thread-manager;1"]
      .getService().currentThread;

  while (thr.hasPendingEvents())
    thr.processNextEvent(true);
}
 
// REPL

let sandbox = gSandbox;
let hasREPL = false;
let _currentModule = '';
let _currentEval = 0;
let _lastEval;  
let _paused = false;

function startRepl(threadClient) {
  let done = false;
  let tempSandbox = null;

  while(!done) {
    pumpEventLoop();
    
    var msg = '';
    if(_currentModule) {
      msg += '...' + _currentModule.slice(_currentModule.length-30);
    }
    if(threadClient.state === 'paused') {
      msg += '(paused)';
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
    case ',pause':
      done = true;
      threadClient.interrupt((res) => {
        startRepl(threadClient);
      });
      break;
    case ',resume':
      done = true;
      threadClient.resume(() => {
        startRepl(threadClient);
      });
      break;
    case ',modules':
      getModules().forEach(function(m, i) {
        print('[' + i + '] ' + m);
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
    case ',global':
      tempSandbox = gSandbox;
      expr = expr.split(' ').slice(1).join(' ');
    default:
      if(!expr.trim()) {
        continue;
      }
      
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
          let nextline = readline();
          if(nextline.trim() === ',quit') {
            break;
          }
          expr += '\n' + nextline;
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
        let res, url;
        let box = tempSandbox || sandbox;
        
        if(tempSandbox || !_currentModule) {
          url = "eval-" + _currentEval;
        }
        else {
          url = _currentModule;
        }

        box.$_ = _lastEval;
        box.$S = 'eval-' + (_currentEval - 1);
        res = _lastEval = Cu.evalInSandbox(
          expr, box, "1.8", url, 1
        );

        if(res && typeof res.then === 'function') {
          done = true;
          res.then((val) => {
            if(val !== undefined) {
              console.log(val);
            }
            setTimeout(startRepl.bind(this, threadClient), 0);
          }, (err) => {
            console.error('Error', err);
            setTimeout(startRepl.bind(this, threadClient), 0);
          });
        }
        else if(res !== undefined) {
          print(res);
        }

        _currentEval++;
      }
      catch(e) {
        print(String(e));
      }

      tempSandbox = null;
      threadClient.removeListener("paused", onPaused);
    }
  }
}
  
let client = new DebuggerClient(DebuggerServer.connectPipe());
client.connect(() => {
  client.listTabs((res) => {
    let chromeDebugger = res.chromeDebugger;

    client.attachTab(res.tabs[0].actor, (res, tabClient) => {
      tabClient.attachThread(null, (res, threadClient) => {
        
        client.attachThread(chromeDebugger, (res, threadClient) => {
          threadClient.resume((res) => {
            gSandbox.CONNECTION = CONNECTION;
            gSandbox.gChromeDebugger = chromeDebugger;
            gSandbox.gClient = client;
            gSandbox.gThreadClient = threadClient;
            gSandbox.console = console;
            gSandbox.resolvePath = resolvePath;
            gSandbox.setTimeout = setTimeout;
            startRepl(threadClient);
          });
        });
      });
    });    
  });
});

startEventLoop();

} catch(e) { print(String(e)); }
