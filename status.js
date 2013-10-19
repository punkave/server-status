var fs = require('fs');
var parse = require('clf-parser');
var glob = require('glob');
var path = require('path');
var _ = require('lodash');
var tail = require('tail');

var cpu = fs.readFileSync('/proc/loadavg', 'utf8');

// Look at 1MB at the end of each site's log file
var bufferSize = 1024 * 1024;

cpu = cpu.match(/^\d+\.\d+/)[0];

var dir = '/var/log/nginx';
if (!fs.existsSync(dir)) {
  dir = '/var/log/apache2';
}

var files = [];

files = files.concat(glob.sync(dir + '/*log'));

files = _.filter(files, function(file) {
  return (file.indexOf('error') === -1);
});

var sites = [];

_.each(files, function(file) {
  var name = path.basename(file);
  name = name.replace(/[\._\-]log/, '');
  name = name.replace(/[\._\-]access/, '');
  if (name === 'access') {
    return;
  }
  sites.push({ name: name, file: file });
});

_.each(sites, function(site) {
  analyze(site);  
});

function analyze(site) {
  var end = fetchEnd(site.file);
  console.log(site.file);
  console.log(end.substr(0, 50));
  var lines = end.split("\n");
  // Ditch the partial line at the beginning
  lines.shift();
  _.some(lines, function(line) {
    var info;
    try {
      info = parse(line);
    } catch (e) {
      // Ignore bad lines
      return;
    }
    if (info) {
      var when = info.time_local;
      try {
        var interval = (new Date()).getTime() - when.getTime();
      } catch (e) {
        // Bad log data
        return false;
      }
      site.accessesPerMinute = lines.length / (interval / 1000.0 / 60.0);
      return true;
    }
    return false;
  });
  console.log(site);
  console.log(lines.length);
  if (site.accessesPerMinute > 1) {
    console.log(site.name + ': ' + site.accessesPerMinute);
  }
}

function fetchEnd(file) {
  var stats = fs.statSync(file);
  var fd = fs.openSync(file, 'r');
  var buffer = new Buffer(bufferSize);
  var length = stats.size;
  
  var position = length - bufferSize;
  if (position < 0) {
    position = 0;
  }
  fs.readSync(fd, buffer, 0, bufferSize, position);
  return buffer.toString('utf8');
}

