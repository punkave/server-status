var config = require('./config.js');

var fs = require('fs');
var parse = require('clf-parser');
var glob = require('glob');
var path = require('path');
var _ = require('lodash');
var Tail = require('always-tail');
var express = require('express');
var exec = require('child_process').exec;

var interval = config.interval;
var apikey = config.apikey;

var dir = '/var/log/nginx';
if (!fs.existsSync(dir)) {
  dir = '/var/log/apache2';
}

var files = [];

files = files.concat(glob.sync(dir + '/*log'));

files = _.filter(files, function(file) {
  return (file.indexOf('error') === -1);
});

var scoreboard = {};

var sites = [];

_.each(files, function(file) {
  addFile(file);
});

function addFile(file) {
  if (_.some(sites, function(site) {
    return site.file === file;
  })) {
    // Already watching
    return;
  }
  var name = path.basename(file);
  name = name.replace(/[\._\-]log/, '');
  name = name.replace(/[\._\-]access/, '');
  if (name === 'access') {
    return;
  }
  sites.push({ 
    name: name, 
    file: file, 
    stats: {
      name: name, 
      interval: interval
    }
  });
}

function removeFile(file) {
  var site = _.find(sites, function(site) {
    return site.file === file;
  });
  if (site) {
    site.shutdown = true;
    sites = _.filter(sites, function(site) {
      return site.file !== file;
    });
  }
}

_.each(sites, function(site) {
  watch(site);  
});

fs.watch(dir, function(event, filename) {
  filename = dir + '/' + filename;
  // Added? Removed? Merely appended to?
  // 'rename' and 'change' are pretty incomplete as events
  // go, folks. Let's just figure it out
  if (fs.existsSync(filename)) {
    addFile(filename);
  } else {
    removeFile(filename);
  }
});

setInterval(serverLevelStats, interval);
       
var app = express();

app.get('/', function(req, res) {
  if (req.query.apikey !== apikey) {
    res.statusCode = 404;
    return res.send('notfound');
  }
  scoreboard.sites = _.map(sites, function(site) {
    return site.stats;
  });
  return res.send(scoreboard);
});

console.log('Listening on port 30000');
app.listen(30000);

function watch(site) {
  var size = fs.statSync(site.file).size;
  var tail = new Tail(site.file, "\n", { start: size });
  var now = getEpoch(new Date());
  var pages = 0;
  var errors = 0;
  var timer = setInterval(flush, interval);
  tail.on('line', function(line) {
    try {
      info = parse(line);
      if (error(info)) {
        errors++;
      }
      if (page(info)) {
        pages++;
      }
    } catch (e) {
      throw e;
      // Don't fuss if a bad line is encountered
    }
  }); 

  function flush() {
    if (site.shutdown) {
      tail.unwatch();
      clearInterval(timer);
      return;
    } 
    site.stats = { 
      name: site.name, 
      pages: pages,
      errors: errors,
      interval: interval 
    };
    now++;
    errors = 0;
    pages = 0;
  }
}

function getEpoch(date) {
  return date.getTime() / interval;
}

// We are interested in server errors, not user errors
function error(info) {
  return (info.status >= 500);
}

function page(info) {
  var matches = info.path.match(/\.\w+$/);
  if (!matches) {
    // No extension, probably a page and therefore interesting
    return true;
  }
  if ((matches[0] === '.html') || (matches[0] === '.php')) {
    // Smells like a page too
    return true;
  }
  // Smells like an asset
  return false;  
}

function serverLevelStats() {
  var cpu = fs.readFileSync('/proc/loadavg', 'utf8');
  scoreboard.cpu = parseFloat(cpu.match(/^\d+\.\d+/)[0]);
  // /opt is usually on the same filesystem as your websites and
  // databases. If not, send us a pull request to handle this sensibly
  // through config.js
  exec('df /opt', function (error, stdout, stderr) {
    var matches = stdout.match(/([\d\.]+)\%/ );
    if (matches) {
      scoreboard.disk = parseFloat(matches[1]);
    } 
  });
}

