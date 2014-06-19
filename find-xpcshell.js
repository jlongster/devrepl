var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');

// configuration

function srcdir() {
  var dir = process.cwd();

  while(dir.length > 1) {
    var file = path.join(dir, 'mozinfo.json');
    if(fs.existsSync(file)) {
      var info = JSON.parse(fs.readFileSync(file));
      return info.topsrcdir;
    }

    file = path.join(dir, 'python', 'mozbuild', 'mozbuild', 'base.py')
    if(fs.existsSync(file)) {
      return dir;
    }

    dir = path.dirname(dir);
  }
}

function objdir(srcdir, cb) {
  var cmd = path.join(srcdir, 'build', 'autoconf', 'config.guess');
  childProcess.exec(cmd, function(err, stdout, stderr) {
    if(err || stderr) {
      throw new Error("couldn't find objdir");
    }
    cb(err || stderr || null, 'obj-' + stdout.trim());
  });
}

function configure(cb) {
  var srcd = srcdir();
  objdir(srcd, function(err, objd) {
    cb(err, {
      srcdir: srcd,
      objdir: objd
    });
  });
}

// app

configure(function(err, config) {
  var xpcshell = path.join(config.srcdir, config.objdir,
                           'dist', 'bin', 'xpcshell');
  console.log(xpcshell);
});
