var config = require('./config.js');

var fs = require('fs');
var parse = require('clf-parser');
var glob = require('glob');
var path = require('path');
var _ = require('lodash');
var Tail = require('always-tail');
var express = require('express');
var exec = require('child_process').exec;
var request = require('request');

var interval = config.interval;
var apikey = config.apikey;
var reportTo = config.reportTo;

var dir = config.dir;
if (!dir) {
  // If we see nginx monitor that, if not monitor Apache.
  // We always use nginx as a reverse proxy to node apps and
  // to mixed node/apache servers, so it should catch all if present
  dir = '/var/log/nginx';
  if (!fs.existsSync(dir)) {
    dir = '/var/log/apache2';
  }
}

var files = [];

files = files.concat(glob.sync(dir + '/*log'));

var scoreboard = {};

var sites = [];

_.each(files, function(file) {
  addFile(file);
});

function addFile(file) {
  if (file.indexOf('error') !== -1) {
    return;
  }
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
    site.shutdown();
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

setInterval(step, interval);
step();

function step() {
  return serverLevelStats(function() {
    _.each(sites, function(site) {
      if (site.flush) {
        site.flush();
      }
    });
    report();
  });
}

function report() {
  console.log('reporting');
  scoreboard.sites = _.map(sites, function(site) {
    return site.stats;
  });
  scoreboard.apikey = apikey;
  request({
    method: 'POST',
    uri: reportTo,
    json: scoreboard
  }, function(err, response, body) {
    if (err) {
      console.error(err);
      // TODO: get the admin's attention in some other way if we cannot talk to the scoreboard server for
      // a long time
    }
  });
}

function watch(site) {
  var size = fs.statSync(site.file).size;
  var tail = new Tail(site.file, "\n", { start: size });
  var now = getEpoch(new Date());
  var pages = 0;
  var errors = 0;
  var errorDetails = [];
  tail.on('line', function(line) {
    try {
      info = parse(line);
      if (error(info)) {
        errors++;
        if (errorDetails.length < 10) {
          errorDetails.push(info);
        }
      }
      if (page(info)) {
        pages++;
      }
    } catch (e) {
      throw e;
      // Don't fuss if a bad line is encountered
    }
    console.log(errorDetails);
  });

  site.shutdown = function() {
    tail.unwatch();
  };

  site.flush = function() {
    site.stats = {
      name: site.name,
      pages: pages,
      errors: errors,
      errorDetails: errorDetails,
      interval: interval
    };
    now++;
    errors = 0;
    errorDetails = [];
    pages = 0;
  };
}

function getEpoch(date) {
  return date.getTime() / interval;
}

// We are interested in server errors, not user errors
function error(info) {
  return (info.status >= 500);
}

function page(info) {
  if (!info.path) {
    return false;
  }
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

function serverLevelStats(callback) {
  var cpu;
  if (fs.existsSync('/proc/loadavg'))
  {
    cpu = fs.readFileSync('/proc/loadavg', 'utf8');
    scoreboard.cpu = parseFloat(cpu.match(/^\d+\.\d+/)[0]);
  }
  // /opt is usually on the same filesystem as your websites and
  // databases. If not, send us a pull request to handle this sensibly
  // through config.js
  exec('df /opt', function (error, stdout, stderr) {
    var matches = stdout.match(/([\d\.]+)\%/ );
    if (matches) {
      scoreboard.disk = parseFloat(matches[1]);
    }
    return callback(null);
  });
}

